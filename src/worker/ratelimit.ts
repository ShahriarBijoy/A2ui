/**
 * Per-IP caps on /api/* (wrangler.jsonc "ratelimits": the Workers Rate Limiting binding, approximate and per
 * Cloudflare location). They stop a runaway loop or a leaked demo key from spending the Claude and Soniox
 * budgets. Turns get their own bucket, so speaking (predict) never uses up turns. A missing binding (unit
 * tests, in-process eval servers) means no cap.
 */
import type { Context, Env as HonoEnv, MiddlewareHandler } from "hono";

/** Structurally the runtime's RateLimit binding. */
export type Limiter = { limit(options: { key: string }): Promise<{ success: boolean }> };
export type Limiters = { turn?: Limiter; api?: Limiter };

export const TOO_MANY_REQUESTS = "Too many requests: wait a minute, then try again.";

export function rateLimit<E extends HonoEnv>(pick: (c: Context<E>) => Limiters): MiddlewareHandler<E> {
  return async (c, next) => {
    const limiters = pick(c);
    const limiter = c.req.path === "/api/turn" ? limiters.turn : limiters.api;
    if (limiter) {
      const { success } = await limiter.limit({ key: c.req.header("cf-connecting-ip") ?? "unknown" });
      if (!success) return c.json({ error: TOO_MANY_REQUESTS }, 429, { "retry-after": "60" });
    }
    await next();
  };
}
