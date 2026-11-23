import { useId } from "react";
import type { TextFieldComponent } from "@shared/a2ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { boundPath, resolveString } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, FieldLabel, FlashWrap, useSurfaceEnv, type BrickProps } from "./shared";

export function TextField({ def, scope, firstSeen }: BrickProps<TextFieldComponent>) {
  const env = useSurfaceEnv();
  const id = useId();
  const ctx = evalCtx(env, scope);
  const path = boundPath(def.value, scope);
  const value = resolveString(def.value, ctx);
  const placeholder = resolveString(def.placeholder, ctx) || undefined;
  // Controlled and written synchronously, so React keeps focus and caret while typing.
  // A literal (unbound) value has nowhere to write, so it stays uncontrolled.
  const valueProps = path ? { value } : { defaultValue: value };
  const write = (v: string) => {
    if (!path) return;
    // A number field stores a number, so actions, knobs and Stat see 6 rather than "6".
    const n = Number(v);
    const value = def.variant === "number" && v.trim() !== "" && Number.isFinite(n) ? n : v;
    store.setData(env.surfaceId, path, value);
  };
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id}>{resolveString(def.label, ctx)}</FieldLabel>
      <FlashWrap path={path} firstSeen={firstSeen}>
        {def.variant === "longText" ? (
          <Textarea
            id={id}
            placeholder={placeholder}
            className="text-base md:text-base"
            {...valueProps}
            onChange={(e) => write(e.target.value)}
          />
        ) : (
          <Input
            id={id}
            type={def.variant === "number" ? "number" : "text"}
            placeholder={placeholder}
            className="h-10 text-base md:text-base"
            {...valueProps}
            onChange={(e) => write(e.target.value)}
          />
        )}
      </FlashWrap>
    </div>
  );
}
