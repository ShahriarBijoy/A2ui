import { useMemo } from "react";
import type { AgentItem, SurfaceState, UserItem } from "@/state";
import { useStore } from "@/store";
import { compactLines, type Line } from "./compact";
import { turnMessages, withActionInput, type TimedMessage } from "./run";

export type TurnView = {
  item: AgentItem | undefined;
  user: UserItem | undefined;
  /** The turn's A2UI messages (a tap's action first), in arrival order, timed from the turn's start. */
  messages: TimedMessage[];
  lines: Line[];
  /** The surface the turn built or changed. */
  surfaceId: string | null;
  surface: SurfaceState | undefined;
};

/** One turn as the hood shows it, rebuilt only when the wire log or the turn's item changes. */
export function useTurnView(turnId: string | null): TurnView {
  const item = useStore((s) => (turnId ? s.thread.find((i): i is AgentItem => i.kind === "agent" && i.turnId === turnId) : undefined));
  const user = useStore((s) => (turnId ? s.thread.find((i): i is UserItem => i.kind === "user" && i.turnId === turnId) : undefined));
  const wire = useStore((s) => s.wire);
  const startedAt = item?.metrics.startedAt ?? null;
  const input = item?.retry.input;
  const fetches = item?.metrics.fetches;
  const messages = useMemo(
    () => (turnId ? withActionInput(input, turnMessages(wire, turnId, startedAt)) : []),
    [wire, turnId, startedAt, input],
  );
  const lines = useMemo(() => compactLines(messages, fetches ?? []), [messages, fetches]);
  const surfaceId = item?.surfaceId ?? item?.updatedSurfaceId ?? null;
  const surface = useStore((s) => (surfaceId ? s.surfaces[surfaceId] : undefined));
  return { item, user, messages, lines, surfaceId, surface };
}
