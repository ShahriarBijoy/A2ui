import { afterEach, describe, expect, mock, test } from "bun:test";
import { BRICK_NAMES } from "@shared/catalog";
import { predictBricks } from "./predict";

const env = { JEV_URL: "https://jev.test/v1/systemone", JEV_API_KEY: "k", JEV_MODEL: "jev-latest" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function mockFetch(handler: (init: RequestInit) => Promise<Response>) {
  globalThis.fetch = mock((_url: string | URL | Request, init?: RequestInit) => handler(init ?? {})) as unknown as typeof fetch;
}

describe("predictBricks", () => {
  test("one noul per brick; probabilities keyed by brick name; engine is the response model", async () => {
    let sent: { state: unknown; questions: Record<string, { type: string; instructions: string }> } | null = null;
    mockFetch(async (init) => {
      sent = JSON.parse(String(init.body));
      const answers = Object.fromEntries(BRICK_NAMES.map((n) => [n, { type: "noul", noul: n === "SeatMap" ? 0.93 : 0.1 }]));
      return Response.json({ model: "jev-1.14.0", answers, usage: { input_tokens: 900, output_tokens: 40 } });
    });
    const r = await predictBricks("I need to book a flight and choose my seat", env);
    expect(r.engine).toBe("jev-1.14.0");
    expect(r.bricks.SeatMap).toBe(0.93);
    expect(Object.keys(r.bricks)).toHaveLength(BRICK_NAMES.length);
    expect(sent).not.toBeNull();
    const q = sent!.questions;
    expect(Object.keys(q)).toEqual([...BRICK_NAMES]);
    expect(q.SeatMap.type).toBe("noul");
    expect(q.SeatMap.instructions).toBe(
      "Will a good screen for this request need a seat map to choose a seat on a plane, train or venue (the `SeatMap` component)?",
    );
    expect(sent!.state).toEqual({
      app: "An agent builds a screen from components for the request.",
      request: "I need to book a flight and choose my seat",
    });
  });

  test("HTTP error → empty bricks, engine names the error, never throws", async () => {
    mockFetch(async () => Response.json({ detail: "rate limited" }, { status: 429 }));
    const r = await predictBricks("book a flight", env);
    expect(r.bricks).toEqual({});
    expect(r.engine).toBe("error: HTTP 429");
  });

  test("network error → empty bricks", async () => {
    mockFetch(() => Promise.reject(new TypeError("fetch failed")));
    const r = await predictBricks("book a flight", env);
    expect(r).toMatchObject({ bricks: {}, engine: "error: network" });
  });

  test("empty text → no request", async () => {
    mockFetch(() => Promise.reject(new Error("should not be called")));
    const r = await predictBricks("   ", env);
    expect(r.bricks).toEqual({});
  });
});
