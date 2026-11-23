import { Fragment } from "react";
import { chipParts, type ChipTone } from "@/format";
import { cn } from "@/lib/utils";
import type { AgentItem } from "@/state";

const TONE: Record<ChipTone, string> = {
  muted: "text-muted-foreground",
  strong: "font-semibold text-foreground",
  // Filled, not tinted text: highlight-coloured text on the page background is too faint from the back row.
  highlight: "rounded-[0.3rem] bg-highlight px-1.5 py-px text-highlight-foreground",
};

/** One mono line of measured numbers under each agent item. The line is always present so nothing shifts when values land. */
export function TurnChip({ item }: { item: AgentItem }) {
  const parts = chipParts(item);
  return (
    <p className="min-h-[1.6em] max-w-full font-mono text-[0.8rem] leading-[1.6] text-muted-foreground" aria-label="Turn metrics">
      {item.replay && (
        <span className="mr-2 inline-block rounded-[0.3rem] border border-input px-1.5 text-[0.7rem] uppercase tracking-[0.12em] text-foreground">
          replay
        </span>
      )}
      {parts.map((p, i) => (
        <Fragment key={p.key}>
          {/* Plain spaces around the dot are the line-break opportunities; each value itself never splits. */}
          {i > 0 && <span aria-hidden className="text-input">{" · "}</span>}
          <span title={p.title} className={cn("whitespace-nowrap", TONE[p.tone])}>
            {p.text}
          </span>
        </Fragment>
      ))}
    </p>
  );
}
