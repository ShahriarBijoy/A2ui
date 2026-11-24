/**
 * Points at a component on the stage while the hood's JSON stream or component table is hovered, and measures the
 * rendered surface for the Run tab's wireframe. DOM only: the surface's React tree is never re-rendered for this.
 */
import { useCallback, useState, type RefCallback } from "react";
import { sameBoxes, type Box } from "./run";

function surfaceElement(surfaceId: string): Element | null {
  return document.querySelector('section[data-surface-id="' + CSS.escape(surfaceId) + '"]');
}

let outlined: Element[] = [];

/** Outlines every drawn instance of the component (a List template draws one per item); null clears. */
export function outlineComponent(surfaceId: string | null, id: string | null): void {
  for (const el of outlined) el.removeAttribute("data-bb-outline");
  outlined = [];
  if (!surfaceId || !id) return;
  const section = surfaceElement(surfaceId);
  if (!section) return;
  outlined = [...section.querySelectorAll('[data-a2ui-id="' + CSS.escape(id) + '"]')];
  for (const el of outlined) el.setAttribute("data-bb-outline", "");
}

export type SurfaceMeasure = { frame: { w: number; h: number } | null; boxes: Box[]; /** Width of the element the hook's ref is on. */ panelW: number };

/** Every [data-a2ui-id] box relative to the surface, in document order; zero-size boxes (hidden bricks) left out. */
export function measureSurface(surfaceId: string): Omit<SurfaceMeasure, "panelW"> {
  const section = surfaceElement(surfaceId);
  if (!section) return { frame: null, boxes: [] };
  const root = section.getBoundingClientRect();
  const boxes: Box[] = [];
  for (const el of section.querySelectorAll<HTMLElement>("[data-a2ui-id]")) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    boxes.push({ id: el.dataset.a2uiId ?? "", x: r.left - root.left, y: r.top - root.top, w: r.width, h: r.height });
  }
  return { frame: { w: root.width, h: root.height }, boxes };
}

/** Waits this long after the last change in the thread: streaming never pays for a measure per message. */
const SETTLE_MS = 250;

/**
 * The surface's boxes, re-measured after the thread settles (DOM changes or a resize). Attach the ref to an element
 * that exists only while the Run tab shows, so nothing observes the thread otherwise.
 */
export function useSurfaceBoxes(surfaceId: string | null): { ref: RefCallback<HTMLElement>; measure: SurfaceMeasure } {
  const [measure, setMeasure] = useState<SurfaceMeasure>({ frame: null, boxes: [], panelW: 0 });
  const ref = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let frame = 0;
      const run = () => {
        frame = 0;
        const next: SurfaceMeasure = { ...(surfaceId ? measureSurface(surfaceId) : { frame: null, boxes: [] }), panelW: el.clientWidth };
        setMeasure((prev) => {
          const sameFrame =
            prev.frame === next.frame ||
            (prev.frame !== null && next.frame !== null && Math.round(prev.frame.w) === Math.round(next.frame.w) && Math.round(prev.frame.h) === Math.round(next.frame.h));
          return sameFrame && prev.panelW === next.panelW && sameBoxes(prev.boxes, next.boxes) ? prev : next;
        });
      };
      const schedule = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (!frame) frame = requestAnimationFrame(run);
        }, SETTLE_MS);
      };
      // The thread lives in <main>; the hood is outside it, so drawing the wireframe never re-triggers this.
      const thread = document.querySelector("main") ?? document.body;
      const mutations = new MutationObserver(schedule);
      mutations.observe(thread, { childList: true, subtree: true, characterData: true });
      const resize = new ResizeObserver(schedule);
      resize.observe(thread);
      resize.observe(el);
      frame = requestAnimationFrame(run);
      return () => {
        clearTimeout(timer);
        if (frame) cancelAnimationFrame(frame);
        mutations.disconnect();
        resize.disconnect();
      };
    },
    [surfaceId],
  );
  return { ref, measure };
}
