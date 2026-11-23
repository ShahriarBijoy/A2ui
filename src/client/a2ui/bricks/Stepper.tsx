import { Minus, Plus } from "lucide-react";
import type { StepperComponent } from "@shared/a2ui";
import { Button } from "@/components/ui/button";
import { boundPath, resolveNumber, resolveString } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, FlashWrap, useSurfaceEnv, type BrickProps } from "./shared";

export function Stepper({ def, scope, firstSeen }: BrickProps<StepperComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const path = boundPath(def.value, scope);
  const min = typeof def.min === "number" ? def.min : 1;
  const max = typeof def.max === "number" && def.max >= min ? def.max : Math.max(min, 20);
  const value = Math.min(max, Math.max(min, Math.round(resolveNumber(def.value, ctx, min))));
  const label = resolveString(def.label, ctx);
  const write = (n: number) => {
    if (path) store.setData(env.surfaceId, path, Math.min(max, Math.max(min, n)));
  };
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-base font-medium">{label}</span>
      <FlashWrap path={path} firstSeen={firstSeen} className="flex items-center gap-3 px-1">
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="size-10"
          aria-label={"Decrease " + (label || "value")}
          disabled={value <= min}
          onClick={() => write(value - 1)}
        >
          <Minus />
        </Button>
        <span className="min-w-[2ch] text-center font-mono text-3xl font-medium tabular-nums" aria-live="polite">
          {value}
        </span>
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className="size-10"
          aria-label={"Increase " + (label || "value")}
          disabled={value >= max}
          onClick={() => write(value + 1)}
        >
          <Plus />
        </Button>
      </FlashWrap>
    </div>
  );
}
