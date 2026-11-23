import type { CSSProperties } from "react";
import type { SeatMapComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { boundPath, resolveString, resolveStringList } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, FlashWrap, useSurfaceEnv, type BrickProps } from "./shared";

const SEAT = "1.75rem";
const AISLE = "0.75rem";
// index.css belongs to the shell; the hatching lives here as an inline style.
const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--border) 0 2px, transparent 2px 6px)",
};

export function SeatMap({ def, scope, firstSeen }: BrickProps<SeatMapComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const path = boundPath(def.value, scope);
  const taken = new Set(resolveStringList(def.taken, ctx).map((s) => s.trim().toUpperCase()));
  const value = resolveString(def.value, ctx).trim().toUpperCase();
  const columns = [...def.layout];
  const rows = Array.from({ length: def.rows }, (_, i) => i + 1);
  const grid: CSSProperties = {
    display: "grid",
    gridTemplateColumns: ["1.5rem", ...columns.map((c) => (c === " " ? AISLE : SEAT))].join(" "),
    gap: "0.25rem",
  };
  const pick = (seat: string) => {
    if (path) store.setData(env.surfaceId, path, seat);
  };

  return (
    <FlashWrap path={path} firstSeen={firstSeen} className="w-fit max-w-full">
      <div className="max-h-[22rem] overflow-auto rounded-md border bg-background/40 px-2 pb-2">
        <div style={grid} className="font-mono text-xs" role="group" aria-label="Seat map">
          <span className="sticky top-0 bg-card/95 pt-2" />
          {columns.map((c, i) => (
            <span key={"h" + i} className="sticky top-0 bg-card/95 pt-2 pb-0.5 text-center text-muted-foreground">
              {c === " " ? "" : c}
            </span>
          ))}
          {rows.map((row) => [
            <span key={"r" + row} className="self-center pr-1 text-right text-muted-foreground tabular-nums">
              {row}
            </span>,
            ...columns.map((c, i) => {
              if (c === " ") return <span key={row + "-" + i} />;
              const seat = String(row) + c.toUpperCase();
              const isTaken = taken.has(seat);
              const isSelected = seat === value;
              return (
                <button
                  key={seat + "-" + i}
                  type="button"
                  aria-label={"Seat " + seat + (isTaken ? ", taken" : "")}
                  aria-pressed={isSelected}
                  disabled={isTaken}
                  onClick={() => pick(seat)}
                  style={isTaken ? HATCH : undefined}
                  className={cn(
                    "h-6 rounded-[5px] border text-[0.6rem] leading-none transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring/60",
                    isSelected
                      ? "border-highlight bg-highlight font-semibold text-highlight-foreground"
                      : isTaken
                        ? "cursor-not-allowed border-border text-transparent"
                        : "border-input bg-card text-muted-foreground/0 hover:bg-accent hover:text-muted-foreground",
                  )}
                >
                  {isSelected ? seat : c}
                </button>
              );
            }),
          ])}
        </div>
      </div>
    </FlashWrap>
  );
}
