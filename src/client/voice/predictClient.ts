/**
 * Debounced /api/predict calls while the speaker talks (PLAN §3.5).
 * The scheduler is pure (injected send + timers) so the debounce and stale-drop rules are unit-tested.
 */
import { apiFetch } from "../apiBase";
import { isBrickName, type BrickName } from "../../shared/catalog";
import { LIMITS, type PredictResponse } from "../../shared/protocol";
import type { StoreApi } from "../state";
import { realTimers, type Timers } from "./transcript";

export type PredictScheduler = {
  /** Call on every transcript change with the full text so far. */
  update(text: string): void;
  /** Drops the pending call and invalidates any in-flight response. */
  cancel(): void;
};

export function createPredictScheduler<R>(opts: {
  delayMs: number;
  minWords: number;
  send: (text: string) => Promise<R | null>;
  onResult: (result: R, text: string) => void;
  timers?: Timers;
}): PredictScheduler {
  const timers = opts.timers ?? realTimers;
  let timer: unknown = null;
  let seq = 0;
  let lastSent = "";

  const clearTimer = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };

  const fire = (text: string) => {
    timer = null;
    lastSent = text;
    const mine = ++seq;
    opts.send(text).then(
      (result) => {
        // A newer request (or cancel) bumped seq: this answer describes words the speaker has moved past.
        if (mine !== seq || result === null) return;
        opts.onResult(result, text);
      },
      () => {
        /* prediction is a bonus: a failed call must never surface */
      },
    );
  };

  return {
    update(raw) {
      const text = raw.trim().replace(/\s+/g, " ");
      clearTimer();
      if (text === "" || text.split(" ").length < opts.minWords || text === lastSent) return;
      timer = timers.set(() => fire(text), opts.delayMs);
    },
    cancel() {
      clearTimer();
      seq++;
      lastSent = "";
    },
  };
}

const latencies: number[] = [];
/** Server-reported `ms` of every /api/predict answer this session (for the report and the debug panel). */
export function getPredictLatencies(): readonly number[] {
  return latencies;
}

async function postPredict(text: string): Promise<PredictResponse | null> {
  const res = await apiFetch("/api/predict", { method: "POST", body: JSON.stringify({ text }) });
  // 404 / 5xx: the route is missing or Jev is down. Stay silent, outlines simply do not appear.
  if (!res.ok) return null;
  const body = (await res.json()) as Partial<PredictResponse>;
  if (!body || typeof body.bricks !== "object" || body.bricks === null) return null;
  return body as PredictResponse;
}

export function createPredictor(store: Pick<StoreApi, "addPredicted">): PredictScheduler {
  return createPredictScheduler<PredictResponse>({
    delayMs: LIMITS.predictDebounceMs,
    minWords: LIMITS.predictMinWords,
    send: postPredict,
    onResult: (res) => {
      if (typeof res.ms === "number") latencies.push(res.ms);
      const names: BrickName[] = [];
      for (const [name, p] of Object.entries(res.bricks)) {
        if (isBrickName(name) && typeof p === "number" && p >= LIMITS.predictThreshold) names.push(name);
      }
      if (names.length > 0) store.addPredicted(names);
    },
  });
}
