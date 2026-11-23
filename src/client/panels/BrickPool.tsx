import { useMemo } from "react";
import { BRICKS, type BrickDef, type BrickGroup } from "@shared/catalog";
import { cn } from "@/lib/utils";
import type { PoolState } from "@/state";

const GROUPS: readonly { group: BrickGroup; label: string }[] = [
  { group: "layout", label: "Layout" },
  { group: "content", label: "Content" },
  { group: "input", label: "Input" },
  { group: "custom", label: "Custom" },
];

type TileState = "idle" | "predicted" | "used";

// Colour-only states (U4): border width, padding and size are identical in all three.
const TILE: Record<TileState, string> = {
  idle: "border-border text-muted-foreground",
  predicted: "border-highlight bg-card text-foreground shadow-[inset_0_0_0_1px_var(--highlight)]",
  used: "border-highlight bg-highlight text-highlight-foreground",
};

export function BrickPool({ pool }: { pool: PoolState }) {
  const used = useMemo(() => new Set(pool.used), [pool.used]);
  const predicted = useMemo(() => new Set(pool.predicted), [pool.predicted]);
  return (
    <section aria-label="Brick pool" className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-4">
        <h2 className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Brick pool
        </h2>
        <span className="font-mono text-[0.6875rem] tabular-nums text-muted-foreground">{BRICKS.length}</span>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-3">
        {GROUPS.map(({ group, label }) => (
          <div key={group} className="mb-3 last:mb-0">
            <h3 className="mb-1 px-1 font-mono text-[0.625rem] uppercase tracking-[0.16em] text-muted-foreground/80">
              {label}
              {group === "custom" && <span className="normal-case tracking-normal"> · Brick Box</span>}
            </h3>
            <ul className="grid grid-cols-2 gap-1.5">
              {BRICKS.filter((b) => b.group === group).map((b) => (
                <Tile
                  key={b.name}
                  def={b}
                  state={used.has(b.name) ? "used" : predicted.has(b.name) ? "predicted" : "idle"}
                  count={pool.counts[b.name] ?? 0}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <Legend />
    </section>
  );
}

function Tile({ def, state, count }: { def: BrickDef; state: TileState; count: number }) {
  return (
    <li
      data-state={state}
      title={def.purpose}
      aria-label={`${def.poolLabel}: ${state}${count ? `, used ${count} times` : ""}`}
      className={cn(
        "flex h-9 min-w-0 items-center gap-1 rounded-md border pr-1.5 pl-2 text-[0.8rem] leading-none",
        "transition-colors duration-150 motion-reduce:transition-none",
        TILE[state],
      )}
    >
      <span className="min-w-0 flex-1 truncate">{def.poolLabel}</span>
      <span className="w-[2ch] shrink-0 text-right font-mono text-[0.6875rem] tabular-nums">{count > 0 ? count : ""}</span>
    </li>
  );
}

function Legend() {
  const item = (state: TileState, label: string) => (
    <span className="flex items-center gap-1.5">
      <span aria-hidden className={cn("size-2.5 rounded-[3px] border", TILE[state])} />
      {label}
    </span>
  );
  return (
    <footer className="flex shrink-0 items-center justify-between gap-2 border-t px-4 py-2.5 font-mono text-[0.625rem] uppercase tracking-[0.1em] text-muted-foreground">
      {item("idle", "idle")}
      {item("predicted", "heard")}
      {item("used", "used")}
    </footer>
  );
}
