import type { ChoicePickerComponent } from "@shared/a2ui";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { boundPath, resolveString, resolveStringList } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, FieldLabel, FlashWrap, useSurfaceEnv, type BrickProps } from "./shared";

export function ChoicePicker({ def, scope, firstSeen }: BrickProps<ChoicePickerComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const path = boundPath(def.value, scope);
  const selected = resolveStringList(def.value, ctx);
  const single = def.variant !== "multipleSelection";

  const onValueChange = (next: string[]) => {
    if (!path) return;
    if (!single) {
      store.setData(env.surfaceId, path, next);
      return;
    }
    // Chips act like radio buttons: tapping the selected chip keeps it selected.
    const picked = next.find((v) => !selected.includes(v)) ?? next[0];
    if (picked !== undefined) store.setData(env.surfaceId, path, [picked]);
  };

  return (
    <div className="flex flex-col gap-2">
      <FieldLabel>{resolveString(def.label, ctx)}</FieldLabel>
      <FlashWrap path={path} firstSeen={firstSeen} className="w-fit max-w-full">
        <ToggleGroup
          value={selected}
          multiple={!single}
          onValueChange={onValueChange}
          variant="outline"
          className="flex-wrap"
          aria-label={resolveString(def.label, ctx) || undefined}
        >
          {def.options.map((option) => (
            <ToggleGroupItem
              key={option.value}
              value={option.value}
              className="h-9 rounded-full px-3.5 font-mono text-sm aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
            >
              {resolveString(option.label, ctx, option.value)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FlashWrap>
    </div>
  );
}
