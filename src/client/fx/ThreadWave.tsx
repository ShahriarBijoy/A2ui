/**
 * Esc on stage: a distortion wave rises from the bottom bar and carries the thread away into the empty state.
 *
 * distortion-waves bends a picture of the DOM, so both views must be still while it runs. Esc gives that:
 * the turn is aborted first, the picture is taken, then the store is cleared under the running wave.
 * At rest `capture` stays off, so the library never re-pictures a streaming thread while the pointer is over it.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { DistortionWave, snapshot, type CaptureRequest, type DistortionWaveHandle, type Rect } from "distortion-waves";
import { store } from "@/store";

type Runner = (clear: () => void) => Promise<void>;
let runner: Runner | null = null;

/** Clears the thread, with the wave when one is mounted and the thread can be pictured; otherwise at once. */
export function clearThreadWithWave(clear: () => void): Promise<void> {
  if (!runner) {
    clear();
    return Promise.resolve();
  }
  return runner(clear);
}

/** Esc must never feel stuck: past this the wave starts with whatever picture it has (or none). */
const PREPARE_BUDGET_MS = 350;

const ROOT_STYLE: CSSProperties = { height: "100%", gridTemplateRows: "minmax(0, 1fr)", gridTemplateColumns: "minmax(0, 1fr)" };

/** Where the wave leaves from: the bottom edge of the thread, under the bottom bar's composer when it is in view. */
function sourceRect(root: HTMLElement): Rect {
  const box = root.getBoundingClientRect();
  const composer = document.querySelector("[data-voice-beam]")?.getBoundingClientRect();
  const left = composer ? Math.max(box.left, composer.left) : box.left;
  const right = composer ? Math.min(box.right, composer.right) : box.right;
  const w = right > left ? right - left : box.width;
  return { x: right > left ? left - box.left : 0, y: box.height - 2, w, h: 2 };
}

const BORDER_WIDTHS = ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"] as const;

/**
 * The library's own capture, plus every element's border widths. Tailwind's preflight gives every element
 * `border: 0 solid`; the snapshot drops a width that matches the browser default (0) but keeps the solid
 * style, so inside the picture each box would draw a 3 px "medium" border. Writing the widths fixes that.
 * The root and layer overrides mirror what the built-in capture forces (distortion-waves 0.1.0).
 */
async function captureWithBorders(req: CaptureRequest): Promise<HTMLCanvasElement> {
  const root = req.element;
  const layer = root.querySelector(`:scope > [data-dw-layer="${req.slot}"]`);
  const rs = getComputedStyle(root);
  const rootForce: Record<string, string> = {
    "border-radius": "0",
    position: "absolute",
    left: `-${rs.borderLeftWidth}`,
    top: `-${rs.borderTopWidth}`,
    right: "auto",
    bottom: "auto",
    margin: "0",
    transform: "none",
    translate: "none",
    rotate: "none",
    scale: "none",
    opacity: "1",
    visibility: "visible",
    width: `${root.offsetWidth}px`,
    height: `${root.offsetHeight}px`,
    "box-sizing": "border-box",
    "min-width": "0",
    "min-height": "0",
    "max-width": "none",
    "max-height": "none",
  };
  const t0 = performance.now();
  const shot = await snapshot(root, {
    width: req.width,
    height: req.height,
    scale: req.scale,
    background: req.background,
    skip: req.ignore,
    force: (el) => {
      const cs = getComputedStyle(el);
      const out: Record<string, string> = {};
      for (const p of BORDER_WIDTHS) out[p] = cs.getPropertyValue(p);
      if (el === root) return { ...out, ...rootForce };
      if (el === layer) return { ...out, opacity: "1", visibility: "visible" };
      return out;
    },
  });
  // Read by the stage checks (wave timing at 1920×1080); costs nothing otherwise.
  performance.measure(`bb-wave-capture-${req.slot}`, { start: t0, detail: { walk: shot.walk, raster: shot.raster, nodes: shot.nodes } });
  return shot.canvas;
}

/** True when `p` settled within `ms`. */
function settlesWithin(p: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve(false), ms);
    p.catch((err: unknown) => console.warn("[wave] picture failed", err)).finally(() => {
      window.clearTimeout(timer);
      resolve(true);
    });
  });
}

/**
 * Both pictures in and current. A picture that went stale before the wave starts would be retaken after the
 * clear, i.e. of the empty thread, and the old thread would vanish instead of being carried away.
 */
async function picturesReady(h: DistortionWaveHandle): Promise<boolean> {
  const deadline = performance.now() + PREPARE_BUDGET_MS;
  for (let round = 0; round < 2; round++) {
    const left = deadline - performance.now();
    if (left <= 0 || !(await settlesWithin(h.prepare(), left))) return false;
    const d = h.controller?.debug;
    // No renderer (no WebGL 2, or reduced motion): the library crossfades and needs no picture.
    if (!d || !d.webgl) return true;
    if (d.content.ready && !d.content.stale && d.revealed.ready && !d.revealed.stale) return true;
  }
  return false;
}

/** One per mounted wave: what Esc (through `runner`) and the wave's onFinish call. */
function createWaveControl(setArmed: (on: boolean) => void) {
  let handle: DistortionWaveHandle | null = null;
  let busy = false;
  let stopWatching: (() => void) | null = null;

  const settle = () => {
    stopWatching?.();
    stopWatching = null;
    handle?.reset();
    setArmed(false);
    busy = false;
  };

  const run: Runner = async (clear) => {
    const h = handle;
    const root = h?.element;
    // Nothing to carry away, a second Esc mid-wave, or an iframe (HTML mode), which the picture leaves out.
    if (!h || !root || busy || store.getState().thread.length === 0 || root.querySelector("iframe")) {
      clear();
      return;
    }
    busy = true;
    const before = store.getState().thread;
    performance.mark("bb-wave-esc");
    // Also flushes the aborted turn's last render, so the picture shows the thread as it now stands.
    flushSync(() => setArmed(true));
    const ready = await picturesReady(h);
    if (handle !== h) {
      clear();
      return;
    }
    if (store.getState().thread !== before) {
      // The thread moved while it was being pictured: a second Esc already cleared it, or a turn began
      // (a voice turn finalising, a hands-free endpoint). Clearing now would wipe that newer turn while its
      // stream runs on into nothing, so the newer intent wins: no wave, no clear.
      performance.mark("bb-wave-skipped");
      busy = false;
      setArmed(false);
      return;
    }
    if (!ready) {
      // Esc never waits on a picture: clear now, without the wave.
      performance.mark("bb-wave-skipped");
      busy = false;
      setArmed(false);
      clear();
      return;
    }
    performance.mark("bb-wave-play");
    h.play({ source: sourceRect(root) });
    clear();
    // A turn started while the wave is out must show at once (U2), so it cuts the wave.
    stopWatching = store.subscribe(() => {
      if (store.getState().thread.length > 0) settle();
    });
  };

  let cancelWarm: (() => void) | null = null;
  const scheduleWarm = (h: DistortionWaveHandle) => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => warm(h));
      cancelWarm = () => window.cancelIdleCallback(id);
    } else {
      const id = window.setTimeout(() => warm(h), 1500);
      cancelWarm = () => window.clearTimeout(id);
    }
  };

  // The page's first WebGL renderer costs ~0.6 s of main thread (measured at 1920×1080: one 640 ms frame);
  // later ones reuse the compiled programs and cost ~0.1 s. Pay it once, at idle after load, not on Esc.
  const warm = (h: DistortionWaveHandle) => {
    if (handle !== h || busy) return;
    // Never in the middle of a turn: the main thread belongs to the stream then. Try again at the next idle.
    if (store.getState().activeTurnId !== null) {
      scheduleWarm(h);
      return;
    }
    flushSync(() => setArmed(true));
    h.prepare()
      .catch((err: unknown) => console.warn("[wave] warm-up failed; the first Esc pays for it", err))
      .finally(() => {
        if (!busy) setArmed(false);
      });
  };

  return {
    attach(h: DistortionWaveHandle | null) {
      if (!h) return;
      handle = h;
      runner = run;
      scheduleWarm(h);
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
    finish() {
      if (busy) settle();
    },
  };
}

export function ThreadWave({ children, empty }: { children: ReactNode; empty: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const [control] = useState(() => createWaveControl(setArmed));
  return (
    <DistortionWave
      ref={control.attach}
      type="vertical"
      palette="#e0714f"
      capture={armed ? captureWithBorders : false}
      prewarm={false}
      // The thread is cleared under the running wave; the outgoing picture must not follow it.
      live={false}
      reducedMotion="system"
      onFinish={control.finish}
      revealedContent={empty}
      style={ROOT_STYLE}
    >
      {children}
    </DistortionWave>
  );
}
