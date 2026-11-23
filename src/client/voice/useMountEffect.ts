import { useEffect, type EffectCallback } from "react";

/** The one sanctioned effect: subscribe to the outside world once on mount, undo on unmount. */
export function useMountEffect(effect: EffectCallback): void {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(effect, []);
}
