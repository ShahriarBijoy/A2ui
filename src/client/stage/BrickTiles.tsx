import { useMemo } from "react";
import { BRICKS, type BrickDef, type BrickGroup } from "@shared/catalog";
import { cn } from "@/lib/utils";
import type { PoolState } from "@/state";
import { BrickGlyph, NEW_BRICK_NAMES } from "./glyphs";

const GROUPS: readonly { group: BrickGroup; label: string }[] = [
  { group: "layout", label: "Layout" },
  { group: "content", label: "Content" },
  { group: "input", label: "Input" },
  { group: "custom", label: "Custom" },
];

type TileState = "idle" | "heard" | "used";

// Colour-only states (U4): border width, padding and size are identical in all three.
const TILE: Record<TileState, string> = {
  idle: "border-border bg-background text-muted-foreground",
  heard: "border-highlight bg-highlight-soft/35 text-highlight-ink",
  used: "border-highlight bg-highlight text-highlight-foreground",
};

/** The brick pool as tiles: every brick the agent may use, lit when the current turn used it or the speech hints at it. */
export function BrickTiles({ pool }: { pool: PoolState }) {
  const used = useMemo(() => new Set<string>(pool.used), [pool.used]);
  const heard = useMemo(() => new Set<string>(pool.predicted), [pool.predicted]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Legend />
      <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-4 [scrollbar-gutter:stable]">
        {GROUPS.map(({ group, label }) => {
          const bricks = BRICKS.filter((b) => b.group === group);
          if (bricks.length === 0) return null;
          return (
            <section key={group} aria-label={label} className="mt-3 first:mt-1">
              <h3 className="mb-1.5 pl-0.5 font-mono text-[0.625rem] tracking-[0.14em] text-muted-foreground/85 uppercase">
                {label}
              </h3>
              <ul className="grid grid-cols-3 gap-1.5">
                {bricks.map((b) => (
                  <Tile
                    key={b.name}
                    def={b}
                    state={used.has(b.name) ? "used" : heard.has(b.name) ? "heard" : "idle"}
                    count={pool.counts[b.name] ?? 0}
                  />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Tile({ def, state, count }: { def: BrickDef; state: TileState; count: number }) {
  const isNew = NEW_BRICK_NAMES.has(def.name);
  return (
    <li
      data-state={state}
      title={def.purpose}
      aria-label={`${def.poolLabel}: ${state}${isNew ? ", new" : ""}${count ? `, used ${count} times` : ""}`}
      className={cn(
        "relative flex min-w-0 flex-col items-center gap-[5px] rounded-[10px] border px-1 pt-[9px] pb-[7px]",
        "transition-colors duration-150 motion-reduce:transition-none",
        TILE[state],
      )}
    >
      <BrickGlyph name={def.name} className="h-5 w-7 shrink-0" />
      <span className="w-full truncate text-center text-[0.71875rem] leading-tight font-medium">{def.poolLabel}</span>
      {isNew && (
        <span
          aria-hidden
          className={cn("absolute top-1.5 right-1.5 size-1.5 rounded-full", state === "used" ? "bg-highlight-foreground" : "bg-highlight")}
        />
      )}
    </li>
  );
}

function Legend() {
  const swatch = (state: TileState) => <span aria-hidden className={cn("size-2.5 rounded-[3px] border", TILE[state])} />;
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3.5 gap-y-1 px-[18px] pb-1.5 font-mono text-[0.6875rem] text-muted-foreground">
      <span className="flex items-center gap-1.5">{swatch("used")}used</span>
      <span className="flex items-center gap-1.5">{swatch("heard")}heard</span>
      <span className="flex items-center gap-1.5">{swatch("idle")}idle</span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="size-1.5 rounded-full bg-highlight" />
        new
      </span>
    </div>
  );
}
