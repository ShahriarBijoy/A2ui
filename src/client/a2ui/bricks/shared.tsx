/**
 * Shared pieces for bricks: the surface environment, child rendering (static ids and
 * List templates), the U5 flash wrapper, labels, skeletons and the refused placeholder.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { ChildList, JsonValue } from "@shared/a2ui";
import { isChildTemplate, isPlainObject } from "@shared/a2ui";
import { getAt, pathsOverlap, resolvePath } from "@shared/pointer";
import type { A2uiAction } from "@shared/a2ui";
import { cn } from "@/lib/utils";
import type { EvalContext } from "@/a2ui/evaluate";
import type { SurfaceState } from "@/state";

export type SurfaceEnv = {
  surfaceId: string;
  surface: SurfaceState;
  interactive: boolean;
  onAction: (a: A2uiAction) => void;
  /** Renders component "id" in "scope"; Surface owns the node wrapper (fade, error boundary, cycle guard). */
  renderNode: (id: string, scope: string, key?: string) => ReactNode;
};

export const SurfaceEnvContext = createContext<SurfaceEnv | null>(null);

export function useSurfaceEnv(): SurfaceEnv {
  const env = useContext(SurfaceEnvContext);
  if (!env) throw new Error("Bricks render only inside <Surface>");
  return env;
}

export type BrickProps<T> = { def: T; scope: string; firstSeen: number };

export function evalCtx(env: SurfaceEnv, scope: string): EvalContext {
  return { data: env.surface.data, scope };
}

/** Children of Row/Column/List: static ids, or one child per array item with scope "<path>/<index>". */
export function renderChildList(env: SurfaceEnv, children: ChildList | undefined, scope: string): ReactNode[] {
  if (Array.isArray(children)) {
    const seen = new Set<string>();
    return children.map((id, i) => {
      const key = seen.has(id) ? id + "#" + i : id;
      seen.add(id);
      return env.renderNode(id, scope, key);
    });
  }
  if (!isChildTemplate(children)) return [];
  const abs = resolvePath(children.path, scope);
  let items: JsonValue | undefined;
  try {
    items = getAt(env.surface.data, abs);
  } catch {
    items = undefined;
  }
  // The data line usually lands after the template: hold the space instead of collapsing.
  if (items === undefined) return [<SkeletonBlock key="pending" className="h-16" />];
  if (!Array.isArray(items)) return [];
  const base = abs === "/" ? "" : abs;
  const seen = new Set<string>();
  return items.map((item, i) => {
    const raw = isPlainObject(item) ? item.id : undefined;
    const itemId = typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
    // Stable keys keep inputs mounted when items are re-sent; duplicates fall back to the index.
    const key = itemId !== null && !seen.has(itemId) ? "id:" + itemId : "i:" + i;
    if (itemId !== null) seen.add(itemId);
    return env.renderNode(children.componentId, base + "/" + i, key);
  });
}

const FLASH_MS = 600;

/**
 * Latest agent change overlapping the bound path. It flashes only when it happened after the
 * component first appeared, so the initial fill of a new surface does not light up every control.
 */
export function useFlash(path: string | null, firstSeen: number): { key: number; active: boolean } {
  const env = useSurfaceEnv();
  if (!path) return { key: 0, active: false };
  let latest = 0;
  for (const [changedPath, at] of Object.entries(env.surface.changed)) {
    if (at <= latest) continue;
    try {
      if (pathsOverlap(changedPath, path)) latest = at;
    } catch {
      // A malformed key cannot match a valid bound path.
    }
  }
  return { key: latest, active: latest > firstSeen && performance.now() - latest < FLASH_MS };
}

/** Keyed on the change timestamp, so each new agent change restarts the 600 ms animation (U5). */
export function FlashWrap(props: { path: string | null; firstSeen: number; className?: string; children: ReactNode }) {
  const flash = useFlash(props.path, props.firstSeen);
  return (
    <div key={flash.key} className={cn("rounded-md", flash.active && "bb-flash", props.className)}>
      {props.children}
    </div>
  );
}

export function FieldLabel(props: { htmlFor?: string; children: ReactNode; className?: string }) {
  if (props.children === "" || props.children === null || props.children === undefined) return null;
  return (
    <label htmlFor={props.htmlFor} className={cn("text-sm font-medium leading-none", props.className)}>
      {props.children}
    </label>
  );
}

export function SkeletonBlock(props: { className?: string }) {
  return <div aria-hidden className={cn("bb-skeleton h-9 w-full min-w-16", props.className)} />;
}

/** U10: calm and small. The agent gets the VALIDATION_FAILED error; the audience sees this. */
export function Refused(props: { type: string; reason?: string }) {
  const extra = props.reason && props.reason !== "Not in the catalog" ? " · " + props.reason.toLowerCase() : "";
  return (
    <div
      role="note"
      className="rounded-md border border-dashed border-input px-3 py-2 font-mono text-xs text-muted-foreground"
    >
      Not in the catalog · {props.type}
      {extra}
    </div>
  );
}

/** Text without the markdown markers, for places that take a plain label (Button). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .trim();
}
