/**
 * Brick prediction while speaking: one Jev request with a Noul per brick.
 * OWNER: decision lane. STUB until implemented: the signature is the contract.
 */
import type { PredictResponse } from "@shared/protocol";

export async function predictBricks(_text: string, _env: Env): Promise<PredictResponse> {
  return { bricks: {}, ms: 0, engine: "stub" };
}
