/**
 * Shared pieces for bricks: the surface environment, child rendering (static ids and
 * List templates), the U5 flash wrapper, labels, skeletons and the refused placeholder.
 */
import { createContext, useContext, type ReactNode } from "react";
import type { A2uiAction, ChildList } from "@shared/a2ui";
import { isChildTemplate } from "@shared/a2ui";
import type { BrickName } from "@shared/catalog";
import { pathsOverlap } from "@shared/pointer";
import { cn } from "@/lib/utils";
import type { EvalContext } from "@/a2ui/evaluate";
import { templateView } from "@/a2ui/template";
import type { SurfaceState } from "@/state";

export type SurfaceEnv = {
  surfaceId: string;
  surface: SurfaceState;
  interactive: boolean;
  onAction: (a: A2uiAction) => void;
  /** A turn is still streaming into this surface: missing data is "on its way", not "absent". */
  streaming: boolean;
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

/** Skeleton per pending template item, sized like the brick it stands in for (U3: no jump on arrival). */
const PENDING_SHAPE: Partial<Record<BrickName, string>> = {
  OptionCard: "h-25 rounded-lg",
  Text: "h-6",
  Stat: "h-16",
  Button: "h-10 w-32",
  Divider: "h-px",
};
const PENDING_ITEMS = 3;

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
  const state = templateView(children, env.surface.data, scope, env.streaming);
  if (state.kind === "skeleton") {
    const entry = env.surface.components[children.componentId];
    const shape = (entry?.status === "ok" && PENDING_SHAPE[entry.def.component]) || "h-20 rounded-lg";
    return Array.from({ length: PENDING_ITEMS }, (_, i) => <SkeletonBlock key={"pending" + i} className={shape} />);
  }
  if (state.kind === "empty") {
    return [
      <p key="empty" className="text-sm text-muted-foreground">
        Nothing found
      </p>,
    ];
  }
  return state.items.map((item) => env.renderNode(children.componentId, item.scope, item.key));
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
  // "Not in the catalog" only when that is true; a catalog brick can be refused for other reasons.
  const text =
    props.reason && props.reason !== "Not in the catalog"
      ? "Refused · " + props.type + " · " + props.reason.toLowerCase()
      : "Not in the catalog · " + props.type;
  return (
    <div
      role="note"
      className="rounded-md border border-dashed border-input px-3 py-2 font-mono text-xs text-muted-foreground"
    >
      {text}
    </div>
  );
}

/** Stand-in for a value whose data has not arrived yet, while its turn still streams (see isPending). */
export function InlineSkeleton(props: { className?: string }) {
  return <span aria-hidden className={cn("bb-skeleton inline-block h-[1em] w-24 align-middle", props.className)} />;
}

/** Text without the markdown markers, for places that take a plain label (Button). */
export function plainText(markdown: string): string {
  return markdown
    .replace(/^#{1,3}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .trim();
}
