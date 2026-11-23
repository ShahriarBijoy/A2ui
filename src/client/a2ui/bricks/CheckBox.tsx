import type { CheckBoxComponent } from "@shared/a2ui";
import { Checkbox } from "@/components/ui/checkbox";
import { boundPath, resolveBoolean, resolveString } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, FlashWrap, useSurfaceEnv, type BrickProps } from "./shared";

export function CheckBox({ def, scope, firstSeen }: BrickProps<CheckBoxComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const path = boundPath(def.value, scope);
  return (
    <FlashWrap path={path} firstSeen={firstSeen} className="w-fit">
      <label className="flex items-center gap-2.5 py-1 text-base">
        <Checkbox
          className="size-5"
          checked={resolveBoolean(def.value, ctx)}
          onCheckedChange={(checked) => {
            if (path) store.setData(env.surfaceId, path, checked);
          }}
        />
        <span>{resolveString(def.label, ctx)}</span>
      </label>
    </FlashWrap>
  );
}
