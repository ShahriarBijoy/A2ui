/**
 * Brick Box Worker: one Hono app. Static assets are served by Workers assets;
 * only /api/* and the public catalog run here (see wrangler.jsonc run_worker_first).
 */
import { Hono } from "hono";
import { CATALOG_PATH, catalogJson } from "@shared/catalog";
import { LIMITS } from "@shared/protocol";
import { anthropicLlm, anthropicWebSearch, composerRefusalFallbackFor, composerThinkingFor } from "./claude";
import { predictBricks } from "./predict";
import { promptContext } from "./prompts";
import { rateLimit } from "./ratelimit";
import { route } from "./router";
import { runSearch } from "./search";
import { createSonioxKey } from "./soniox";
import { parseTurnRequest, runTurn, sseResponse, type TurnDeps } from "./turn";

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

/** Per-IP caps after the key check, so only key holders are counted (see ratelimit.ts). */
app.use("/api/*", rateLimit<AppEnv>((c) => ({ turn: c.env.TURN_LIMITER, api: c.env.API_LIMITER })));

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

/** One turn as an SSE stream (PLAN §3.1, §4). Validation errors are real HTTP statuses, before the stream opens. */
app.post("/api/turn", async (c) => {
  const body = await readJsonBody(c.req.raw, LIMITS.maxBodyBytes);
  if (!body.ok) return c.json({ error: body.error }, body.status);
  const parsed = parseTurnRequest(body.value);
  if (!parsed.ok) return c.json({ error: parsed.message }, 400);
  const env = c.env;
  const origin = new URL(c.req.url).origin;
  const context = promptContext({ venue: env.VENUE_NAME, city: env.VENUE_CITY, address: venueAddress(env), catalogId: origin + CATALOG_PATH, devNow: devNow(env) });
  const webSearch = anthropicWebSearch(env);
  const composerModel = optionalVar(env, "COMPOSER_MODEL");
  const deps: TurnDeps = {
    route: (req, signal) => route(req, env, signal),
    llm: anthropicLlm(env),
    ...(composerModel
      ? {
          composerLlm: anthropicLlm({ ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY, LLM_MODEL: composerModel }, composerThinkingFor(composerModel), {
            refusalFallback: composerRefusalFallbackFor(composerModel),
          }),
        }
      : {}),
    context,
    search: (req, signal) => runSearch(req, webSearch, context, signal),
    now: () => performance.now(),
    composeTimeoutMs: LIMITS.composeTimeoutMs,
    routeGuardMs: LIMITS.routerTimeoutMs + 400,
  };
  return sseResponse((emit, signal) => runTurn(parsed.req, deps, emit, signal), c.req.raw.signal);
});

/** Brick prediction while speaking (PLAN §3.5). */
app.post("/api/predict", async (c) => {
  const body = await readJsonBody(c.req.raw, 4 * 1024);
  if (!body.ok) return c.json({ error: body.error }, body.status);
  const text = typeof body.value === "object" && body.value !== null && "text" in body.value ? body.value.text : undefined;
  if (typeof text !== "string" || !text.trim()) return c.json({ error: "text must be a non-empty string" }, 400);
  if (text.length > LIMITS.maxUtteranceChars) return c.json({ error: `text is longer than ${LIMITS.maxUtteranceChars} characters` }, 400);
  return c.json(await predictBricks(text.trim(), c.env));
});

/** A temporary Soniox key for the browser; the long-lived key stays here. */
app.get("/api/soniox-key", async (c) => {
  try {
    return c.json(await createSonioxKey(c.env.SONIOX_API_KEY), 200, { "cache-control": "no-store" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Soniox temporary key failed";
    console.error("soniox-key", message);
    return c.json({ error: message }, 502);
  }
});

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error("worker error", err);
  return c.json({ error: "internal error" }, 500);
});

/** Dev-only clock override for rehearsals (.dev.vars or the process env; never in wrangler.jsonc). */
function devNow(env: Env): string | undefined {
  return optionalVar(env, "DEV_NOW");
}

/** A var that is only set in .dev.vars (DEV_NOW, COMPOSER_MODEL): absent from the generated Env type. */
function optionalVar(env: Env, name: string): string | undefined {
  const v: unknown = (env as unknown as Record<string, unknown>)[name];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Optional var (not in wrangler.jsonc yet): the venue's street address for "nearby" searches. */
function venueAddress(env: Env): string | undefined {
  if (!("VENUE_ADDRESS" in env)) return undefined;
  const v = env.VENUE_ADDRESS;
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

type BodyResult = { ok: true; value: unknown } | { ok: false; status: 400 | 413; error: string };

/** Enforces the size limit on the bytes actually read, not only on content-length. */
async function readJsonBody(req: Request, maxBytes: number): Promise<BodyResult> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return { ok: false, status: 413, error: `body larger than ${maxBytes} bytes` };
  const buf = await req.arrayBuffer();
  if (buf.byteLength > maxBytes) return { ok: false, status: 413, error: `body larger than ${maxBytes} bytes` };
  try {
    return { ok: true, value: JSON.parse(new TextDecoder().decode(buf)) };
  } catch {
    return { ok: false, status: 400, error: "body is not valid JSON" };
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default app;
