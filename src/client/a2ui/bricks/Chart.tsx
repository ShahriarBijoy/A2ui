import type { ChartComponent } from "@shared/a2ui";
import { resolveString, toNumber, toText } from "@/a2ui/evaluate";
import { areaGeometry, barWidths, formatAmount, resolveItems, thinLabels, withUnit, type ItemsView } from "./items";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const MAX_BARS = 12;
const PENDING_WIDTHS = [82, 58, 36];
const MAX_POINTS = 48;
const MAX_X_LABELS = 6;

/** Horizontal bars on one scale with their values (type "area": a filled line); an item without a number is left out. */
export function Chart({ def, scope }: BrickProps<ChartComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const view = resolveItems(def.items, env.surface.data, scope, env.streaming);
  const unit = resolveString(def.unit, ctx);
  if (def.type === "area") return <AreaChart view={view} unit={unit} />;
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

/** Points with a number, in order; an item without one is left out. */
function series(view: ItemsView, max: number): { label: string; value: number }[] {
  return (view.kind === "items" ? view.items : [])
    .flatMap((item) => {
      const value = toNumber(item.value);
      return value === undefined ? [] : [{ label: toText(item.label), value }];
    })
    .slice(0, max);
}

/**
 * A series over time (hours, days) as a line with a light fill, on one scale from its min to its max.
 * y labels at max, midpoint and min; x labels thinned so they never collide. Theme colours only.
 */
function AreaChart({ view, unit }: { view: ItemsView; unit: string }) {
  if (view.kind === "skeleton") return <div aria-hidden className="bb-skeleton h-36 w-full rounded-md" />;
  const pts = series(view, MAX_POINTS);
  if (pts.length === 0) return <p className="text-sm text-muted-foreground">Nothing found</p>;
  const g = areaGeometry(pts.map((p) => p.value));
  const label = (v: number) => withUnit(formatAmount(v), unit);
  const yLabels = g.ticks.map((t) => ({ ...t, text: label(t.value) }));
  const widest = yLabels.reduce((a, t) => (t.text.length > a.length ? t.text : a), "");
  const last = pts.length - 1;
  return (
    <figure aria-label="Area chart" className="grid w-full grid-cols-[auto_minmax(0,1fr)] gap-x-2 gap-y-1.5">
      <div aria-hidden className="relative h-28 font-mono text-xs text-muted-foreground tabular-nums">
        {/* Sizes the column to the widest label; the labels themselves sit at their heights. */}
        <span className="invisible block whitespace-nowrap">{widest}</span>
        {yLabels.map((t) => (
          <span key={t.y} className="absolute right-0 -translate-y-1/2 whitespace-nowrap" style={{ top: t.y + "%" }}>
            {t.text}
          </span>
        ))}
      </div>
      <div className="relative h-28">
        <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible text-foreground">
          {g.ticks.map((t) => (
            <line key={t.y} x1={0} x2={100} y1={t.y} y2={t.y} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          ))}
          <path d={g.area} fill="currentColor" fillOpacity={0.08} />
          <path d={g.line} fill="none" stroke="currentColor" strokeOpacity={0.8} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
      </div>
      <span aria-hidden />
      <div aria-hidden className="relative h-4 font-mono text-xs text-muted-foreground tabular-nums">
        {thinLabels(pts.length, MAX_X_LABELS).map((i) => (
          <span
            key={i}
            className="absolute top-0 whitespace-nowrap"
            style={{ left: g.points[i].x + "%", transform: `translateX(${i === 0 && last > 0 ? "0" : i === last && last > 0 ? "-100%" : "-50%"})` }}
          >
            {pts[i].label}
          </span>
        ))}
      </div>
      <ul className="sr-only">
        {pts.map((p, i) => (
          <li key={i}>
            {p.label}: {label(p.value)}
          </li>
        ))}
      </ul>
    </figure>
  );
}
