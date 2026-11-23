/**
 * The Esc → wave → clear state machine behind ThreadWave. Kept apart from React and the DOM so it can be tested
 * with a fake wave handle and the real store (waveControl.test.ts).
 *
 * Contract on stage: every Esc clears the thread and leaves capture off afterwards, whatever the wave library
 * does. Any throw from it falls back to a plain clear with one console.warn. The exceptions are deliberate:
 * a turn that began while the thread was being pictured is kept, and a thread someone else already cleared
 * is left alone.
 */
import { flushSync } from "react-dom";
import type { Rect } from "distortion-waves";
import type { StoreApi, ThreadItem } from "@/state";
import { store as appStore } from "@/store";

/** The part of DistortionWaveHandle this uses; the real handle satisfies it structurally. */
export type WaveHandle = {
  readonly element: HTMLElement | null;
  prepare(): Promise<void>;
  play(options?: { source?: Rect }): void;
  reset(): void;
  readonly controller: { readonly debug: WaveDebug } | null;
};
export type WaveDebug = {
  webgl: boolean;
  content: { ready: boolean; stale: boolean };
  revealed: { ready: boolean; stale: boolean };
};

export type WaveControlDeps = {
  /** Turns the library's capture on (around a transition) or off (at rest). */
  setArmed: (on: boolean) => void;
  /** Where the wave leaves from, in the wave element's own CSS pixels. */
  sourceOf: (root: HTMLElement) => Rect;
  store?: Pick<StoreApi, "getState" | "subscribe">;
  /** How long Esc may wait for current pictures before it clears without the wave. */
  budgetMs?: number;
  /** Runs `fn` when the browser is idle; returns a cancel. */
  scheduleIdle?: (fn: () => void) => () => void;
  warn?: (message: string, err: unknown) => void;
};

export type Clear = () => void;

/** Esc may wait this long for both pictures; past it the thread clears at once, without the wave. */
export const PREPARE_BUDGET_MS = 350;

let runner: ((clear: Clear) => Promise<void>) | null = null;

/** Clears the thread, with the wave when one is mounted and the thread can be pictured; otherwise at once. */
export async function clearThreadWithWave(clear: Clear): Promise<void> {
  if (!runner) {
    clear();
    return;
  }
  await runner(clear);
}

function defaultScheduleIdle(fn: () => void): () => void {
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(fn);
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(fn, 1500);
  return () => clearTimeout(id);
}

function mark(name: string): void {
  // Read by the stage checks (wave timing); costs nothing otherwise.
  if (typeof performance !== "undefined" && typeof performance.mark === "function") performance.mark(name);
}

/** True when `p` settled within `ms`. */
function settlesWithin(p: Promise<void>, ms: number, warn: (m: string, e: unknown) => void): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    p.catch((err: unknown) => warn("[wave] picture failed", err)).finally(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** A turn began: the thread holds an item the outgoing one did not. Updates to existing items do not count. */
function hasNewItem(before: readonly ThreadItem[], now: readonly ThreadItem[]): boolean {
  if (now === before) return false;
  const ids = new Set(before.map((i) => i.id));
  return now.some((i) => !ids.has(i.id));
}

export function createWaveControl(deps: WaveControlDeps) {
  const st = deps.store ?? appStore;
  const budgetMs = deps.budgetMs ?? PREPARE_BUDGET_MS;
  const scheduleIdle = deps.scheduleIdle ?? defaultScheduleIdle;
  const warn = deps.warn ?? ((message: string, err: unknown) => console.warn(message, err));

  let handle: WaveHandle | null = null;
  let busy = false;
  let stopWatching: (() => void) | null = null;
  let cancelWarm: (() => void) | null = null;

  const safeReset = (h: WaveHandle) => {
    try {
      h.reset();
    } catch (err) {
      warn("[wave] reset failed", err);
    }
  };

  const disarm = () => {
    busy = false;
    deps.setArmed(false);
  };

  /** The wave is over (finished, or cut by a new turn): back to the live thread, capture off. */
  const settle = () => {
    stopWatching?.();
    stopWatching = null;
    const h = handle;
    disarm();
    if (h) safeReset(h);
  };

  /**
   * Both pictures in and current. A picture that went stale before the wave starts would be retaken after the
   * clear, i.e. of the empty thread, and the old thread would vanish instead of being carried away.
   */
  const picturesReady = async (h: WaveHandle): Promise<boolean> => {
    const deadline = performance.now() + budgetMs;
    for (let round = 0; round < 2; round++) {
      const left = deadline - performance.now();
      if (left <= 0 || !(await settlesWithin(h.prepare(), left, warn))) return false;
      const d = h.controller?.debug;
      // No renderer (no WebGL 2, or reduced motion): the library crossfades and needs no picture.
      if (!d || !d.webgl) return true;
      if (d.content.ready && !d.content.stale && d.revealed.ready && !d.revealed.stale) return true;
    }
    return false;
  };

  const run = async (clear: Clear): Promise<void> => {
    const h = handle;
    const root = h?.element ?? null;
    // Nothing to carry away, a second Esc mid-wave, or an iframe (HTML mode), which the picture leaves out.
    if (!h || !root || busy || st.getState().thread.length === 0 || root.querySelector("iframe")) {
      clear();
      return;
    }
    busy = true;
    const before = st.getState().thread;
    // "done": cleared here or kept on purpose. Anything else reaching `finally` falls back to a plain clear.
    let done = false;
    let waving = false;
    const clearNow = () => {
      done = true;
      clear();
    };
    try {
      mark("bb-wave-esc");
      // Also flushes the aborted turn's last render, so the picture shows the thread as it now stands.
      flushSync(() => deps.setArmed(true));
      const ready = await picturesReady(h);
      if (handle !== h) return;
      const now = st.getState().thread;
      if (now.length === 0) {
        // A second Esc already cleared it.
        mark("bb-wave-skipped");
        done = true;
        return;
      }
      if (hasNewItem(before, now)) {
        // A turn began while the thread was being pictured (a voice turn finalising, a hands-free endpoint).
        // Clearing now would wipe it while its stream runs on into nothing: the newer intent wins.
        mark("bb-wave-skipped");
        done = true;
        return;
      }
      if (!ready) {
        mark("bb-wave-skipped");
        clearNow();
        return;
      }
      mark("bb-wave-play");
      h.play({ source: deps.sourceOf(root) });
      waving = true;
      clearNow();
      // A turn started while the wave is out must show at once (U2), so it cuts the wave. The reset runs after
      // the store's listener loop, so the wave library can never break the turn's own render.
      const watch = st.subscribe(() => {
        if (st.getState().thread.length === 0 || stopWatching !== watch) return;
        stopWatching();
        stopWatching = null;
        queueMicrotask(() => {
          if (busy) settle();
        });
      });
      stopWatching = watch;
    } catch (err) {
      warn("[wave] Esc fell back to a plain clear", err);
      if (waving) {
        // A wave that started must not stay over the thread.
        stopWatching?.();
        stopWatching = null;
        waving = false;
        safeReset(h);
      }
    } finally {
      if (!done && !hasNewItem(before, st.getState().thread)) clear();
      if (!waving) disarm();
    }
  };

  // The page's first WebGL renderer costs ~0.6 s of main thread (measured at 1920×1080: one 640 ms frame);
  // later ones reuse the compiled programs and cost ~0.1 s. Pay it once, at idle after load, not on Esc.
  const warm = (h: WaveHandle) => {
    cancelWarm = null;
    if (handle !== h || busy) return;
    // Never in the middle of a turn: the main thread belongs to the stream then. Try again at the next idle.
    if (st.getState().activeTurnId !== null) {
      cancelWarm = scheduleIdle(() => warm(h));
      return;
    }
    let pictured: Promise<void>;
    try {
      flushSync(() => deps.setArmed(true));
      pictured = h.prepare();
    } catch (err) {
      warn("[wave] warm-up failed; the first Esc pays for it", err);
      if (!busy) deps.setArmed(false);
      return;
    }
    pictured
      .catch((err: unknown) => warn("[wave] warm-up failed; the first Esc pays for it", err))
      .finally(() => {
        if (!busy) deps.setArmed(false);
      });
  };

  return {
    /** Ref callback for the DistortionWave handle. */
    attach(h: WaveHandle | null) {
      if (!h) return;
      handle = h;
      runner = run;
      cancelWarm = scheduleIdle(() => warm(h));
      return () => {
        cancelWarm?.();
        cancelWarm = null;
        if (runner === run) runner = null;
        stopWatching?.();
        stopWatching = null;
        handle = null;
        busy = false;
      };
    },
    /** The wave's onFinish. */
    finish() {
      if (busy) settle();
    },
    run,
  };
}
