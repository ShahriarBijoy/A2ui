/**
 * Brick prediction while speaking: one Jev request with a Noul per brick.
 * A visual, not a dependency: never throws, empty bricks on any failure.
 */
import { BRICKS } from "@shared/catalog";
import type { JevQuestions } from "@shared/knobs";
import { LIMITS } from "@shared/protocol";
import type { PredictResponse } from "@shared/protocol";
import { decide, JevError } from "./jev";
import type { JevEnv } from "./jev";

export const PREDICT_TIMEOUT_MS = 1500;

const APP = "An agent builds a screen from components for the request.";

/** Question id = brick name: alphanumeric, unique, and maps straight back to the pool. */
export const PREDICT_QUESTIONS: JevQuestions = Object.fromEntries(
  BRICKS.map((b) => [
    b.name,
    {
      type: "noul" as const,
      instructions: "Will a good screen for this request need " + b.predictHint + " (the `" + b.name + "` component)?",
    },
  ]),
);

export async function predictBricks(text: string, env: JevEnv): Promise<PredictResponse> {
  const t0 = Date.now();
  const request = text.trim().slice(0, LIMITS.maxUtteranceChars);
  if (!request) return { bricks: {}, ms: 0, engine: "skipped: empty text" };
  try {
    const res = await decide(env, { app: APP, request }, PREDICT_QUESTIONS, { timeoutMs: PREDICT_TIMEOUT_MS });
    const bricks: PredictResponse["bricks"] = {};
    for (const b of BRICKS) {
      const a = res.answers[b.name];
      if (a && a.type === "noul") bricks[b.name] = a.noul;
    }
    return { bricks, ms: Date.now() - t0, engine: res.model };
  } catch (err) {
    const why = err instanceof JevError ? (err.kind === "http" ? "HTTP " + err.status : err.kind) : "unknown";
    return { bricks: {}, ms: Date.now() - t0, engine: "error: " + why };
  }
}
