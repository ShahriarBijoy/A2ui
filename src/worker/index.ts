/**
 * Brick Box Worker: one Hono app. Static assets are served by Workers assets;
 * only /api/* and the public catalog run here (see wrangler.jsonc run_worker_first).
 */
import { Hono } from "hono";
import { CATALOG_PATH, catalogJson } from "@shared/catalog";

type AppEnv = { Bindings: Env };

const app = new Hono<AppEnv>();

/** Public: the catalog is part of the story ("the agent can only use these bricks"). */
app.get(CATALOG_PATH, (c) => c.json(catalogJson(new URL(c.req.url).origin + CATALOG_PATH)));

/** Every /api route needs x-demo-key, so strangers cannot spend the API keys. */
app.use("/api/*", async (c, next) => {
  const expected = c.env.DEMO_KEY;
  const got = c.req.header("x-demo-key") ?? "";
  if (!expected || !timingSafeEqual(got, expected)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    llm: c.env.LLM_MODEL,
    jev: c.env.JEV_MODEL,
    venue: `${c.env.VENUE_NAME}, ${c.env.VENUE_CITY}`,
    keys: {
      anthropic: Boolean(c.env.ANTHROPIC_API_KEY),
      jev: Boolean(c.env.JEV_API_KEY),
      soniox: Boolean(c.env.SONIOX_API_KEY),
    },
  }),
);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error("worker error", err);
  return c.json({ error: "internal error" }, 500);
});

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default app;
