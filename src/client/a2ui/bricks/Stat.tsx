import type { StatComponent } from "@shared/a2ui";
import { isPending, resolve, resolveString, toText } from "@/a2ui/evaluate";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

/** Label above value; the value in tabular figures so a row of stats lines up. */
export function Stat({ def, scope }: BrickProps<StatComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const pending = env.streaming && isPending(def.value, ctx);
  const raw = resolve(def.value, ctx);
  const value = typeof raw === "number" ? new Intl.NumberFormat("en").format(raw) : toText(raw);
  const unit = resolveString(def.unit, ctx);
  return (
    <div className="bb-stat flex min-w-0 flex-col gap-1.5">
      <span className="truncate text-[0.8125rem] leading-tight font-medium text-muted-foreground">{resolveString(def.label, ctx)}</span>
      <span className="flex items-baseline gap-1.5">
        {pending ? (
          <InlineSkeleton className="h-8 w-24" />
        ) : value ? (
          <span className="text-[1.75rem] leading-none font-semibold tracking-[-0.02em] tabular-nums">{value}</span>
        ) : null}
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}
