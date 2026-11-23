import { useSyncExternalStore } from "react";

// One query object for the page: the glow samples it every frame.
const query: MediaQueryList | null =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;

export function prefersReducedMotion(): boolean {
  return query?.matches ?? false;
}

function subscribe(onChange: () => void): () => void {
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, () => false);
}
