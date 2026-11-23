import { useId } from "react";
import type { DateTimeInputComponent } from "@shared/a2ui";
import { Input } from "@/components/ui/input";
import { boundPath, formatDate, resolveString } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, FieldLabel, FlashWrap, useSurfaceEnv, type BrickProps } from "./shared";

/** Flags win; without them the value's own shape decides ("HH:mm", "YYYY-MM-DD", or both). */
function inputType(def: DateTimeInputComponent, value: string): "date" | "time" | "datetime-local" {
  const valueHasDate = /^\d{4}-\d{2}-\d{2}/.test(value);
  const valueHasTime = /\d{1,2}:\d{2}/.test(value);
  const date = def.enableDate ?? (def.enableTime === true ? valueHasDate : !(valueHasTime && !valueHasDate));
  const time = def.enableTime ?? valueHasTime;
  if (date && time) return "datetime-local";
  return time ? "time" : "date";
}

export function DateTimeInput({ def, scope, firstSeen }: BrickProps<DateTimeInputComponent>) {
  const env = useSurfaceEnv();
  const id = useId();
  const ctx = evalCtx(env, scope);
  const path = boundPath(def.value, scope);
  const value = resolveString(def.value, ctx);
  const type = inputType(def, value);
  const day = type !== "time" && /^\d{4}-\d{2}-\d{2}/.test(value) ? formatDate(value.slice(0, 10), "EEE") : "";
  return (
    <div className="flex flex-col gap-2">
      <FieldLabel htmlFor={id}>{resolveString(def.label, ctx)}</FieldLabel>
      <FlashWrap path={path} firstSeen={firstSeen} className="flex w-fit items-center gap-3">
        <Input
          id={id}
          type={type}
          value={value}
          className="h-10 w-auto font-mono text-base md:text-base"
          onChange={(e) => {
            if (path) store.setData(env.surfaceId, path, e.target.value);
          }}
        />
        {day ? <span className="w-[3ch] font-mono text-sm text-muted-foreground">{day}</span> : null}
      </FlashWrap>
    </div>
  );
}
