import type { SliderComponent } from "@shared/a2ui";
import { Slider as UiSlider } from "@/components/ui/slider";
import { boundPath, resolveNumber, resolveString } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, FieldLabel, FlashWrap, useSurfaceEnv, type BrickProps } from "./shared";

export function Slider({ def, scope, firstSeen }: BrickProps<SliderComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const path = boundPath(def.value, scope);
  const value = Math.min(def.max, Math.max(def.min, resolveNumber(def.value, ctx, def.min)));
  // "steps" is read as the increment; anything unusable falls back to 1.
  const step = typeof def.steps === "number" && def.steps > 0 && def.steps <= def.max - def.min ? def.steps : 1;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <FieldLabel>{resolveString(def.label, ctx)}</FieldLabel>
        <span className="font-mono text-base tabular-nums">{value}</span>
      </div>
      <FlashWrap path={path} firstSeen={firstSeen} className="py-1.5">
        {/* The shadcn wrapper draws one thumb per array item: always pass [value]. */}
        <UiSlider
          value={[value]}
          min={def.min}
          max={def.max}
          step={step}
          onValueChange={(v) => {
            const next = typeof v === "number" ? v : v[0];
            if (path && typeof next === "number") store.setData(env.surfaceId, path, next);
          }}
        />
      </FlashWrap>
    </div>
  );
}
