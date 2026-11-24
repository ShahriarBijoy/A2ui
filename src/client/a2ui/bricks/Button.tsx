import type { ReactNode } from "react";
import type { ButtonComponent } from "@shared/a2ui";
import { Button as UiButton } from "@/components/ui/button";
import { evalChecks, resolveString } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, plainText, useSurfaceEnv, type BrickProps, type SurfaceEnv } from "./shared";

const VARIANT = { primary: "default", default: "outline", borderless: "ghost" } as const;

function label(env: SurfaceEnv, childId: string, scope: string): ReactNode {
  const entry = env.surface.components[childId];
  // A label still on its way pulses only while the turn streams; a turn that ended without it leaves it empty.
  if (!entry) return env.streaming ? <span aria-hidden className="bb-skeleton inline-block h-4 w-16" /> : null;
  if (entry.status === "ok" && entry.def.component === "Text") {
    return plainText(resolveString(entry.def.text, evalCtx(env, scope)));
  }
  return env.renderNode(childId, scope);
}

export function Button({ def, scope }: BrickProps<ButtonComponent>) {
  const env = useSurfaceEnv();
  const check = evalChecks(def["@checks"], evalCtx(env, scope));
  const variant = VARIANT[def.variant ?? "default"] ?? "outline";
  return (
    <div className="flex flex-col items-start gap-1.5">
      <UiButton
        type="button"
        variant={variant}
        disabled={!check.ok}
        className="h-10 px-4 text-base"
        onClick={() => {
          if (!env.interactive) return;
          env.onAction(store.emitAction(env.surfaceId, def.id, def.action, scope));
        }}
      >
        {label(env, def.child, scope)}
      </UiButton>
      {!check.ok && check.message ? <p className="text-sm text-muted-foreground">{check.message}</p> : null}
    </div>
  );
}
