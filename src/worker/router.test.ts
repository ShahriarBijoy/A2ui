import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { deriveKnobs } from "@shared/knobs";
import type { CatalogComponent } from "@shared/a2ui";
import type { TurnRequest } from "@shared/protocol";
import { warmJev } from "./jev";
import { route } from "./router";

const env = { JEV_URL: "https://jev.test/v1/systemone", JEV_API_KEY: "test-key", JEV_MODEL: "jev-latest" };

const components: CatalogComponent[] = [
  { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/booking/guests" } },
];
const data = { booking: { guests: 4 } };

function request(text: string, withKnobs = true): TurnRequest {
  return {
    mode: "a2ui",
    decision: true,
    input: { type: "utterance", text },
    thread: [],
    surface: { id: "s2", components: [], data, knobs: withKnobs ? deriveKnobs(components, data) : [] },
    nextSurfaceId: "s3",
  };
}

const realFetch = globalThis.fetch;
let calls: { url: string; init: RequestInit }[] = [];

function mockFetch(handler: (init: RequestInit) => Promise<Response>) {
  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(init ?? {});
  }) as unknown as typeof fetch;
}

/** Resolves only when the request is aborted, like a hung connection. */
function hang(init: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

beforeEach(() => {
  calls = [];
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("route", () => {
  test("no knobs → compose without calling Jev", async () => {
    mockFetch(() => Promise.reject(new Error("should not be called")));
    const r = await route(request("make it six", false), env);
    expect(r).toMatchObject({ decision: "compose", reason: "no knobs", patches: [] });
    expect(calls).toHaveLength(0);
  });

  test("tap actions are not routed", async () => {
    mockFetch(() => Promise.reject(new Error("should not be called")));
    const req = request("");
    req.input = { type: "action", action: { name: "confirm", surfaceId: "s2", sourceComponentId: "b", timestamp: "", context: {} } };
    const r = await route(req, env);
    expect(r.reason).toBe("tap action");
    expect(calls).toHaveLength(0);
  });

  test("a clear edit → patch, with auth header, model and input tokens", async () => {
    mockFetch(async () =>
      Response.json({
        model: "jev-1.14.0",
        answers: {
          kind: { type: "choice", choice: "edit", confidence: 1, probabilities: { edit: 1, new: 0, other: 0 } },
          k0: { type: "choice", choice: "8", confidence: 1, probabilities: { unchanged: 0, "8": 1 } },
        },
        usage: { input_tokens: 512, output_tokens: 20 },
      }),
    );
    const r = await route(request("make it eight people"), env);
    expect(r.decision).toBe("patch");
    expect(r.engine).toBe("jev-1.14.0");
    expect(r.inputTokens).toBe(512);
    expect(r.patches).toEqual([{ knobId: "/booking/guests", path: "/booking/guests", value: 8, confidence: 1 }]);
    const { url, init } = calls[0];
    expect(url).toBe(env.JEV_URL);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("jev-latest");
    expect(body.state.utterance).toBe("make it eight people");
    expect(Object.keys(body.questions)).toEqual(["kind", "k0"]);
  });

  test("timeout → compose with the timeout reason, never throws", async () => {
    mockFetch(hang);
    const t0 = Date.now();
    const r = await route(request("make it eight people"), env);
    const took = Date.now() - t0;
    expect(r).toMatchObject({ decision: "compose", reason: "router timeout (>800 ms)", engine: "jev-latest" });
    expect(took).toBeGreaterThanOrEqual(790);
    expect(took).toBeLessThan(1500);
  });

  test("HTTP error → compose with the status", async () => {
    mockFetch(async () => Response.json({ detail: "overloaded" }, { status: 529 }));
    const r = await route(request("make it eight people"), env);
    expect(r).toMatchObject({ decision: "compose", reason: "router error: 529" });
  });

  test("network failure and malformed answers → compose", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect((await route(request("six"), env)).reason).toBe("router error: network");
    mockFetch(async () => Response.json({ model: "jev", answers: { kind: { type: "noul", noul: 1 } }, usage: {} }));
    expect((await route(request("six"), env)).reason).toBe("router error: invalid");
    mockFetch(async () => new Response("not json", { status: 200 }));
    expect((await route(request("six"), env)).reason).toBe("router error: invalid");
  });

  test("caller abort → compose 'router aborted'", async () => {
    mockFetch(hang);
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20);
    const r = await route(request("six"), env, ctrl.signal);
    expect(r).toMatchObject({ decision: "compose", reason: "router aborted" });
  });
});

describe("warmJev", () => {
  test("GET /v1/models with the bearer key, drains the body, returns ms", async () => {
    mockFetch(async () => Response.json({ models: [] }));
    const ms = await warmJev(env);
    expect(typeof ms).toBe("number");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://jev.test/v1/models");
    expect(calls[0].init.method ?? "GET").toBe("GET");
    expect(new Headers(calls[0].init.headers).get("authorization")).toBe("Bearer test-key");
  });

  test("never throws: HTTP error, network error, hang (1500 ms timeout)", async () => {
    mockFetch(async () => new Response("no", { status: 401 }));
    expect(await warmJev(env)).toBeGreaterThanOrEqual(0);
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    expect(await warmJev(env)).toBeGreaterThanOrEqual(0);
    mockFetch(hang);
    const ms = await warmJev(env);
    expect(ms).toBeGreaterThanOrEqual(1490);
    expect(ms).toBeLessThan(2500);
  });
});
