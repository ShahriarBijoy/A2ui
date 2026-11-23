/**
 * Esc on stage: a distortion wave rises from the bottom bar and carries the thread away into the empty state.
 *
 * distortion-waves bends a picture of the DOM, so both views must be still while it runs. Esc gives that:
 * the turn is aborted first, the picture is taken, then the store is cleared under the running wave.
 * At rest `capture` stays off, so the library never re-pictures a streaming thread while the pointer is over it.
 * The Esc logic itself is in waveControl.ts.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { DistortionWave, snapshot, type CaptureRequest, type Rect } from "distortion-waves";
import { createWaveControl } from "./waveControl";

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

export function ThreadWave({ children, empty }: { children: ReactNode; empty: ReactNode }) {
  const [armed, setArmed] = useState(false);
  const [control] = useState(() => createWaveControl({ setArmed, sourceOf: sourceRect }));
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
