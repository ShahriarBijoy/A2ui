import { useId, useState } from "react";
import type { TextFieldComponent } from "@shared/a2ui";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { boundPath, resolveString } from "@/a2ui/evaluate";
import { parseNumberDraft } from "@/a2ui/numberDraft";
import { store } from "@/store";
import { evalCtx, FieldLabel, FlashWrap, useSurfaceEnv, type BrickProps } from "./shared";

/**
 * Text input with a local draft while focused: "12." or "-" are kept as typed (the stored number
 * would render them as "12" or "" and move the caret), and the data model gets a number only once
 * the draft is a complete number.
 */
function NumberField(props: { id: string; placeholder?: string; stored: string; write: (v: number | string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <Input
      id={props.id}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      placeholder={props.placeholder}
      className="h-10 font-mono text-base md:text-base"
      value={draft ?? props.stored}
      onFocus={() => setDraft(props.stored)}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        const parsed = parseNumberDraft(text);
        if (parsed.kind === "number") props.write(parsed.value);
        else if (parsed.kind === "empty") props.write("");
      }}
    />
  );
}

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
  const write = (v: number | string) => {
    if (path) store.setData(env.surfaceId, path, v);
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
        ) : def.variant === "number" && path ? (
          <NumberField id={id} placeholder={placeholder} stored={value} write={write} />
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
