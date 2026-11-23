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

/**
 * Question id = brick name: alphanumeric, unique, and maps straight back to the pool.
 * "One of the few components this request is really about" instead of "will a good screen need":
 * the latter lit 11 of 17 bricks on the flight-seat sentence (layout bricks are always "needed").
 * Measured in lane-D-report.md (fix round 1).
 */
export const PREDICT_QUESTIONS: JevQuestions = Object.fromEntries(
  BRICKS.map((b) => [
    b.name,
    {
      type: "noul" as const,
      instructions: "Is " + b.predictHint + " (the `" + b.name + "` component) one of the few components this request is really about?",
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
    const why =
      err instanceof JevError
        ? err.kind === "http"
          ? "HTTP " + err.status
          : err.kind
        : (err instanceof Error ? err.message : String(err)).slice(0, 80);
    return { bricks: {}, ms: Date.now() - t0, engine: "error: " + why };
  }
}
