import type { StatComponent } from "@shared/a2ui";
import { isPending, resolve, resolveString, toText } from "@/a2ui/evaluate";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

export function Stat({ def, scope }: BrickProps<StatComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const pending = env.streaming && isPending(def.value, ctx);
  const raw = resolve(def.value, ctx);
  const value = typeof raw === "number" ? new Intl.NumberFormat("en").format(raw) : toText(raw);
  const unit = resolveString(def.unit, ctx);
  return (
    <div className="flex flex-col gap-1">
      <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
        {resolveString(def.label, ctx)}
      </span>
      <span className="flex items-baseline gap-1.5">
        {pending ? (
          <InlineSkeleton className="h-9 w-28" />
        ) : value ? (
          <span className="font-mono text-3xl font-medium tabular-nums">{value}</span>
        ) : null}
        {unit ? <span className="text-sm text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}
