import { CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { AlertComponent } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import { isPending, resolveString } from "@/a2ui/evaluate";
import { BRICK_ICON_STROKE } from "./Icon";
import { evalCtx, InlineSkeleton, useSurfaceEnv, type BrickProps } from "./shared";

const VARIANT: Record<NonNullable<AlertComponent["variant"]>, { icon: LucideIcon; box: string; tone: string }> = {
  info: { icon: Info, box: "border-info/25 bg-info-soft/70", tone: "text-info" },
  warning: { icon: TriangleAlert, box: "border-warning/25 bg-warning-soft/70", tone: "text-warning" },
  success: { icon: CircleCheck, box: "border-success/25 bg-success-soft/70", tone: "text-success" },
};

export function Alert({ def, scope }: BrickProps<AlertComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const style = VARIANT[def.variant ?? "info"] ?? VARIANT.info;
  const Glyph = style.icon;
  const title = resolveString(def.title, ctx).trim();
  const pending = env.streaming && isPending(def.text, ctx);
  const text = resolveString(def.text, ctx).trim();
  return (
    <div role="note" className={cn("flex w-full gap-3 rounded-[14px] border px-4 py-3.5", style.box)}>
      <Glyph aria-hidden size={18} strokeWidth={BRICK_ICON_STROKE} className={cn("mt-0.5 shrink-0", style.tone)} />
      <div className="flex min-w-0 flex-col gap-0.5">
        {title ? <p className="text-base leading-snug font-semibold">{title}</p> : null}
        {pending ? <InlineSkeleton className="h-4 w-48" /> : text ? <p className="text-sm leading-snug text-foreground/80">{text}</p> : null}
      </div>
    </div>
  );
}
