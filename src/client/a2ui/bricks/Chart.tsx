import type { ChartComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { resolveString, toNumber, toText } from "@/a2ui/evaluate";
import { formatAmount, resolveItems } from "./items";
import { niceScale, scalePct } from "./chartScale";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const MAX_BARS = 12;
const PENDING_WIDTHS = [82, 58, 36];

/** Horizontal bars on one round scale, faint gridlines and axis labels, the value beside each bar. An item without a number is left out. */
export function Chart({ def, scope }: BrickProps<ChartComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const view = resolveItems(def.items, env.surface.data, scope, env.streaming);
  const unit = resolveString(def.unit, ctx);
  if (view.kind === "skeleton") {
    return (
      <div aria-hidden className="grid grid-cols-[6rem_minmax(0,1fr)] items-center gap-x-3 gap-y-3">
        {PENDING_WIDTHS.map((w) => (
          <div key={w} className="contents">
            <InlineSkeleton className="h-4 w-20" />
            <div className="bb-skeleton h-2.5" style={{ width: w + "%" }} />
          </div>
        ))}
      </div>
    );
  }
  const bars = (view.kind === "items" ? view.items : [])
    .flatMap((item) => {
      const value = toNumber(item.value);
      return value === undefined ? [] : [{ label: toText(item.label), value }];
    })
    .slice(0, MAX_BARS);
  if (bars.length === 0) return <p className="text-sm text-muted-foreground">Nothing found</p>;
  const scale = niceScale(bars.map((b) => b.value));
  const last = scale.ticks.length - 1;
  // Gridlines at every tick; labels at 0, the middle and the top, so they never crowd a narrow chart.
  const labelled = new Set([0, Math.floor(last / 2), last]);
  return (
    <div role="list" aria-label="Bar chart" className="grid grid-cols-[fit-content(38%)_minmax(4rem,1fr)_auto] items-center gap-x-3 gap-y-2.5">
      <span aria-hidden className="pointer-events-none relative col-start-2 self-stretch" style={{ gridRow: `1 / span ${bars.length}` }}>
        {scale.ticks.map((tick, i) => (
          <span key={i} className="absolute -inset-y-1 w-px bg-border/80" style={{ left: scalePct(tick, scale) + "%" }} />
        ))}
      </span>
      {bars.map((b, i) => (
        <div key={i} role="listitem" className="contents">
          <span className="col-start-1 truncate text-sm" style={{ gridRow: i + 1 }} title={b.label}>
            {b.label}
          </span>
          <span aria-hidden className="relative col-start-2 h-3" style={{ gridRow: i + 1 }}>
            <span
              className="absolute inset-y-0 left-0 rounded-[3px] bg-foreground/80 transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: scalePct(b.value, scale) + "%" }}
            />
          </span>
          <span className="col-start-3 text-right font-mono text-sm whitespace-nowrap tabular-nums" style={{ gridRow: i + 1 }}>
            {formatAmount(b.value)}
            {unit ? <span className="ml-1 text-muted-foreground">{unit}</span> : null}
          </span>
        </div>
      ))}
      <span aria-hidden className="relative col-start-2 h-4 font-mono text-[0.6875rem] text-muted-foreground tabular-nums" style={{ gridRow: bars.length + 1 }}>
        {scale.ticks.map((tick, i) =>
          labelled.has(i) ? (
            <span
              key={i}
              className={cn("absolute top-0 whitespace-nowrap", i === last && i > 0 ? "-translate-x-full" : i > 0 && "-translate-x-1/2")}
              style={{ left: scalePct(tick, scale) + "%" }}
            >
              {formatAmount(tick)}
            </span>
          ) : null,
        )}
      </span>
    </div>
  );
}
