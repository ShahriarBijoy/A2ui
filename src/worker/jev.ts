/**
 * Jev (TypeSafe System One) client: one POST, typed answers, hard timeout.
 * Facts in NOTES.md "Jev": Bearer auth, body {model, state, questions}, no streaming.
 */
import { isPlainObject } from "@shared/a2ui";
import type { JsonObject } from "@shared/a2ui";
import type { JevAnswer, JevAnswers, JevQuestions, JevUsage } from "@shared/knobs";

/**
 * The slice of the Worker Env that Jev needs. Structural, so bun tests and scripts
 * (compiled without worker-configuration.d.ts) can call it; the real Env is assignable.
 */
export type JevEnv = { JEV_URL: string; JEV_API_KEY: string; JEV_MODEL: string };

export type JevErrorKind = "timeout" | "aborted" | "http" | "network" | "invalid";

export class JevError extends Error {
  readonly kind: JevErrorKind;
  readonly status?: number;
  constructor(kind: JevErrorKind, message: string, status?: number) {
    super(message);
    this.name = "JevError";
    this.kind = kind;
    this.status = status;
  }
}

export type DecideResult = { answers: JevAnswers; model: string; ms: number; usage: JevUsage };

export async function decide(
  env: JevEnv,
  state: JsonObject,
  questions: JevQuestions,
  opts: { signal?: AbortSignal; timeoutMs: number },
): Promise<DecideResult> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  let timedOut = false;
  // The timer stays armed until the body is parsed: a slow body is as late as a slow header.
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs);
  const onAbort = () => ctrl.abort();
  if (opts.signal?.aborted) ctrl.abort();
  else opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    let res: Response;
    let text: string;
    try {
      res = await fetch(env.JEV_URL, {
        method: "POST",
        headers: { authorization: "Bearer " + env.JEV_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ model: env.JEV_MODEL, state, questions }),
        signal: ctrl.signal,
      });
      text = await res.text();
    } catch (err) {
      if (timedOut) throw new JevError("timeout", "Jev timeout (>" + opts.timeoutMs + " ms)");
      if (opts.signal?.aborted) throw new JevError("aborted", "Jev request aborted");
      throw new JevError("network", "Jev network error: " + short(err instanceof Error ? err.message : String(err)));
    }
    if (!res.ok) throw new JevError("http", "Jev HTTP " + res.status + ": " + errorDetail(text), res.status);
    const parsed = parseResponse(text, questions);
    return { ...parsed, ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onAbort);
  }
}

function parseResponse(text: string, questions: JevQuestions): Omit<DecideResult, "ms"> {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new JevError("invalid", "Jev response is not JSON");
  }
  if (!isPlainObject(body) || !isPlainObject(body.answers)) throw new JevError("invalid", "Jev response has no answers");
  const answers: JevAnswers = {};
  for (const [id, q] of Object.entries(questions)) {
    const a = parseAnswer(body.answers[id]);
    if (!a || a.type !== q.type) throw new JevError("invalid", "Jev answer missing or malformed: " + id);
    answers[id] = a;
  }
  const usage = isPlainObject(body.usage) ? body.usage : {};
  return {
    answers,
    model: typeof body.model === "string" ? body.model : "jev",
    usage: { input_tokens: num(usage.input_tokens), output_tokens: num(usage.output_tokens) },
  };
}

function parseAnswer(v: unknown): JevAnswer | null {
  if (!isPlainObject(v)) return null;
  if (v.type === "noul") {
    return typeof v.noul === "number" && Number.isFinite(v.noul) ? { type: "noul", noul: v.noul } : null;
  }
  if (v.type === "choice") {
    if (typeof v.choice !== "string" || !isPlainObject(v.probabilities)) return null;
    const probabilities: Record<string, number> = {};
    for (const [k, p] of Object.entries(v.probabilities)) {
      if (typeof p !== "number" || !Number.isFinite(p)) return null;
      probabilities[k] = p;
    }
    const confidence = typeof v.confidence === "number" && Number.isFinite(v.confidence) ? v.confidence : 0;
    return { type: "choice", choice: v.choice, confidence, probabilities };
  }
  return null;
}

function errorDetail(text: string): string {
  try {
    const body: unknown = JSON.parse(text);
    if (isPlainObject(body) && body.detail !== undefined) {
      return short(typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail));
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return short(text) || "no detail";
}

function short(s: string): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > 120 ? one.slice(0, 119) + "…" : one;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
