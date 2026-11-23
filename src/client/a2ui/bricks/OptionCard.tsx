import type { OptionCardComponent } from "@shared/a2ui";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { resolveBoolean, resolveString, resolveStringList } from "@/a2ui/evaluate";
import { store } from "@/store";
import { evalCtx, useSurfaceEnv, type BrickProps } from "./shared";

export function OptionCard({ def, scope }: BrickProps<OptionCardComponent>) {
  const env = useSurfaceEnv();
  const ctx = evalCtx(env, scope);
  const title = resolveString(def.title, ctx);
  const subtitle = resolveString(def.subtitle, ctx);
  const tags = resolveStringList(def.tags, ctx);
  const price = resolveString(def.price, ctx);
  const selected = resolveBoolean(def.selected, ctx);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => {
        if (!env.interactive || !def.action) return;
        env.onAction(store.emitAction(env.surfaceId, def.id, def.action, scope));
      }}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border bg-card p-3.5 text-left transition-colors outline-none",
        "hover:bg-accent/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        selected && "border-highlight bg-highlight-soft/40",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-base font-medium leading-snug">{title}</span>
        {subtitle ? <span className="text-sm text-muted-foreground">{subtitle}</span> : null}
        {tags.length > 0 ? (
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {tags.map((tag, i) => (
              <Badge key={tag + i} variant="outline" className="font-normal">
                {tag}
              </Badge>
            ))}
          </span>
        ) : null}
      </span>
      {price ? <span className="shrink-0 font-mono text-base tabular-nums">{price}</span> : null}
    </button>
  );
}
