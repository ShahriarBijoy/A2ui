import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { rateLimit, TOO_MANY_REQUESTS, type Limiter, type Limiters } from "./ratelimit";

type Call = { name: string; key: string };

function limiter(name: string, calls: Call[], allow: boolean): Limiter {
  return {
    limit: async ({ key }) => {
      calls.push({ name, key });
      return { success: allow };
    },
  };
}

function appWith(limiters: Limiters) {
  const app = new Hono();
  app.use("/api/*", rateLimit(() => limiters));
  app.get("/api/health", (c) => c.json({ ok: true }));
  app.post("/api/turn", (c) => c.json({ ok: true }));
  return app;
}

const headers = { "cf-connecting-ip": "203.0.113.7" };

describe("rateLimit", () => {
  test("no binding → no cap", async () => {
    expect((await appWith({}).request("/api/health", { headers })).status).toBe(200);
  });

  test("under the cap → passes through, keyed by client IP", async () => {
    const calls: Call[] = [];
    const res = await appWith({ api: limiter("api", calls, true) }).request("/api/health", { headers });
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ name: "api", key: "203.0.113.7" }]);
  });

  test("over the cap → 429 with retry-after and a readable error", async () => {
    const calls: Call[] = [];
    const res = await appWith({ api: limiter("api", calls, false), turn: limiter("turn", calls, true) }).request("/api/health", { headers });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toEqual({ error: TOO_MANY_REQUESTS });
    expect(calls.map((c) => c.name)).toEqual(["api"]);
  });

  test("turns use their own bucket", async () => {
    const calls: Call[] = [];
    const res = await appWith({ api: limiter("api", calls, true), turn: limiter("turn", calls, false) }).request("/api/turn", { method: "POST", headers });
    expect(res.status).toBe(429);
    expect(calls.map((c) => c.name)).toEqual(["turn"]);
  });

  test("no client IP header → one shared bucket", async () => {
    const calls: Call[] = [];
    await appWith({ api: limiter("api", calls, true) }).request("/api/health");
    expect(calls).toEqual([{ name: "api", key: "unknown" }]);
  });
});
