import type { ChartComponent } from "@shared/a2ui";
import { resolveString, toNumber, toText } from "@/a2ui/evaluate";
import { barWidths, formatAmount, resolveItems } from "./items";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const MAX_BARS = 12;
const PENDING_WIDTHS = [82, 58, 36];

/** Horizontal bars on one scale with their values; an item without a number is left out. */
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
  const widths = barWidths(bars.map((b) => b.value));
  return (
    <ul aria-label="Bar chart" className="grid grid-cols-[fit-content(40%)_minmax(4rem,1fr)_auto] items-center gap-x-3 gap-y-2.5">
      {bars.map((b, i) => (
        <li key={i} className="contents">
          <span className="truncate text-sm" title={b.label}>
            {b.label}
          </span>
          <span aria-hidden className="h-2.5 overflow-hidden rounded-full bg-muted">
            <span
              className="block h-full rounded-full bg-foreground/80 transition-[width] duration-300 ease-out motion-reduce:transition-none"
              style={{ width: widths[i] + "%" }}
            />
          </span>
          <span className="text-right font-mono text-sm whitespace-nowrap tabular-nums">
            {formatAmount(b.value)}
            {unit ? <span className="ml-1 text-muted-foreground">{unit}</span> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
