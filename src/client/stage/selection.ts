/**
 * Which turn the hood shows. It follows the newest turn; clicking a turn in the thread or a run-history row pins
 * that turn until the next turn begins (or the session changes), then the hood follows the newest again.
 * Kept outside AppState: it is a view choice of the stage, not conversation state.
 */
import { useMemo, useSyncExternalStore } from "react";
import type { AgentItem, StoreApi, ThreadItem } from "@/state";
import { store, useStore } from "@/store";

export function newestAgentTurnId(thread: readonly ThreadItem[]): string | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    const item = thread[i];
    if (item.kind === "agent") return item.turnId;
  }
  return null;
}

/** The pinned turn when it is still in the thread, else the newest turn. */
export function selectedTurnId(thread: readonly ThreadItem[], pinned: string | null): string | null {
  if (pinned !== null && thread.some((i): i is AgentItem => i.kind === "agent" && i.turnId === pinned)) return pinned;
  return newestAgentTurnId(thread);
}

export type TurnSelection = {
  /** Pins a turn; pinning the newest (or null) follows the newest again. */
  pin(turnId: string | null): void;
  getPinned(): string | null;
  subscribe(listener: () => void): () => void;
};

export function createTurnSelection(st: Pick<StoreApi, "getState" | "subscribe">): TurnSelection {
  let pinned: string | null = null;
  let newest = newestAgentTurnId(st.getState().thread);
  const listeners = new Set<() => void>();
  const set = (next: string | null) => {
    if (next === pinned) return;
    pinned = next;
    for (const l of [...listeners]) l();
  };
  // A new turn (live, replay, tap) or another session: the hood goes back to following the newest turn.
  st.subscribe(() => {
    const n = newestAgentTurnId(st.getState().thread);
    if (n === newest) return;
    newest = n;
    set(null);
  });
  return {
    pin(turnId) {
      set(turnId === null || turnId === newestAgentTurnId(st.getState().thread) ? null : turnId);
    },
    getPinned: () => pinned,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export const turnSelection: TurnSelection = createTurnSelection(store);

export function selectTurn(turnId: string): void {
  turnSelection.pin(turnId);
}

export function followNewestTurn(): void {
  turnSelection.pin(null);
}

export function usePinnedTurnId(): string | null {
  return useSyncExternalStore(turnSelection.subscribe, turnSelection.getPinned, turnSelection.getPinned);
}

/** The turn the hood shows. */
export function useSelectedTurnId(): string | null {
  const pinned = usePinnedTurnId();
  const thread = useStore((s) => s.thread);
  return useMemo(() => selectedTurnId(thread, pinned), [thread, pinned]);
}
