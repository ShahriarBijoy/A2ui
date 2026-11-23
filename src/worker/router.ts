/**
 * ROUTE: one Jev request per utterance → patch (skip LLM) or compose.
 * OWNER: decision lane. STUB until implemented: the signature is the contract.
 * Must never throw and never exceed LIMITS.routerTimeoutMs (on timeout/error → decision "compose").
 */
import type { RouteResult, TurnRequest } from "@shared/protocol";

export async function route(_req: TurnRequest, _env: Env, _signal?: AbortSignal): Promise<RouteResult> {
  return { kind: "new", kindConfidence: 0, decision: "compose", patches: [], ms: 0, engine: "stub", reason: "router not implemented" };
}
