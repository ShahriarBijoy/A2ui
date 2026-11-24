import type { BadgeComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { isPending, resolveString } from "@/a2ui/evaluate";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const VARIANT: Record<NonNullable<BadgeComponent["variant"]>, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  success: "border-success/30 bg-success-soft text-success",
  warning: "border-warning/30 bg-warning-soft text-warning",
  danger: "border-destructive/30 bg-danger-soft text-destructive",
};

export function Badge({ def, scope }: BrickProps<BadgeComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  if (env.streaming && isPending(def.text, ctx)) return <InlineSkeleton className="h-6 w-16 rounded-full" />;
  const text = resolveString(def.text, ctx).trim();
  if (!text) return null;
  return (
    <span
      className={cn(
        "inline-flex h-6 max-w-full items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        VARIANT[def.variant ?? "neutral"] ?? VARIANT.neutral,
      )}
    >
      <span className="truncate">{text}</span>
    </span>
  );
}
