/**
 * ROUTE: one Jev request per utterance → patch (skip the LLM) or compose.
 * Never throws and never waits longer than LIMITS.routerTimeoutMs: routing must not block a turn.
 */
import { answersToRoute, buildRouteRequest } from "@shared/knobs";
import { LIMITS } from "@shared/protocol";
import type { RouteResult, TurnRequest } from "@shared/protocol";
import { decide, JevError } from "./jev";
import type { JevEnv } from "./jev";

export async function route(req: TurnRequest, env: JevEnv, signal?: AbortSignal): Promise<RouteResult> {
  const t0 = Date.now();
  const engine = env.JEV_MODEL || "jev";
  const compose = (reason: string): RouteResult => ({
    kind: "new",
    kindConfidence: 0,
    decision: "compose",
    patches: [],
    ms: Date.now() - t0,
    engine,
    reason,
  });
  try {
    const knobs = req.surface?.knobs ?? [];
    if (knobs.length === 0) return compose("no knobs");
    if (req.input.type !== "utterance") return compose("tap action");
    const utterance = req.input.text.slice(0, LIMITS.maxUtteranceChars);
    const { state, questions } = buildRouteRequest(utterance, knobs);
    const res = await decide(env, state, questions, { signal, timeoutMs: LIMITS.routerTimeoutMs });
    const result = answersToRoute(res.answers, knobs, Date.now() - t0, res.model);
    return { ...result, inputTokens: res.usage.input_tokens };
  } catch (err) {
    if (err instanceof JevError) {
      if (err.kind === "timeout") return compose("router timeout (>" + LIMITS.routerTimeoutMs + " ms)");
      if (err.kind === "aborted") return compose("router aborted");
      if (err.kind === "http") return compose("router error: " + err.status);
      return compose("router error: " + err.kind);
    }
    return compose("router error: " + (err instanceof Error ? err.message.slice(0, 80) : "unknown"));
  }
}
