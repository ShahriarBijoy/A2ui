import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import type { ProgressComponent } from "@shared/a2ui";
import { ProgressIndicator, ProgressLabel, ProgressTrack } from "@/components/ui/progress";
import { isPending, resolve, resolveString, toNumber } from "@/a2ui/evaluate";
import { formatAmount } from "./items";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

export function Progress({ def, scope }: BrickProps<ProgressComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const max = typeof def.max === "number" && def.max > 0 ? def.max : 100;
  const raw = toNumber(resolve(def.value, ctx));
  const value = raw === undefined ? null : Math.min(max, Math.max(0, raw));
  const label = resolveString(def.label, ctx).trim();
  const pending = env.streaming && isPending(def.value, ctx);
  const shown = value === null ? "" : max === 100 ? formatAmount(value) + "%" : formatAmount(value) + " / " + formatAmount(max);
  return (
    <ProgressPrimitive.Root value={value} max={max} aria-label={label || undefined} className="flex w-full flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        {label ? <ProgressLabel className="text-sm font-medium">{label}</ProgressLabel> : <span />}
        {pending ? <InlineSkeleton className="h-4 w-10" /> : <span className="font-mono text-sm text-muted-foreground tabular-nums">{shown}</span>}
      </div>
      <ProgressTrack className="h-2">
        <ProgressIndicator className="rounded-full motion-reduce:transition-none" />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}
