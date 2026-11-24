/**
 * Renders one A2UI surface from its "root" component. Missing ids render as skeletons (U3),
 * refused components as calm placeholders (U10); a brick that throws is contained by its node.
 */
import { Component, createContext, useContext, useMemo, type ErrorInfo, type JSX, type ReactNode } from "react";
import type { A2uiAction } from "@shared/a2ui";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { surfaceStreaming, useStore } from "@/store";
import { brickComponent } from "./bricks";
import { Refused, SkeletonBlock, SurfaceEnvContext, useSurfaceEnv, type SurfaceEnv } from "./bricks/shared";

/** Ids on the path from root; a repeat means a cycle, which would otherwise recurse forever. */
const AncestryContext = createContext<readonly string[]>([]);
const MAX_DEPTH = 24;

type BoundaryProps = { type: string; resetKey: unknown; children: ReactNode };

class BrickBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("[a2ui] " + this.props.type + " failed to render", error, info.componentStack);
  }

  componentDidUpdate(prev: BoundaryProps): void {
    // A re-sent definition gets a fresh chance to render.
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render(): ReactNode {
    if (this.state.failed) return <Refused type={this.props.type} reason="Could not render" />;
    return this.props.children;
  }
}

function Node({ id, scope }: { id: string; scope: string }): JSX.Element {
  const env = useSurfaceEnv();
  const ancestors = useContext(AncestryContext);
  const entry = env.surface.components[id];
  // U3: an id that has not arrived yet holds its place, but only while a turn still streams into this surface.
  // A turn that ended without it (aborted, left mid-turn, saved and reloaded) never sends it: show nothing, not a
  // placeholder that pulses forever.
  if (!entry) return env.streaming ? <SkeletonBlock /> : <></>;
  if (ancestors.includes(id) || ancestors.length >= MAX_DEPTH) {
    const type = entry.status === "ok" ? entry.def.component : entry.component;
    return <Refused type={type} reason="Cycle" />;
  }
  if (entry.status === "refused") {
    return (
      <div data-a2ui-id={id} className="bb-appear min-w-0">
        <Refused type={entry.component} reason={entry.reason} />
      </div>
    );
  }
  const def = entry.def;
  const Brick = brickComponent(def);
  const weight = typeof def.weight === "number" && def.weight > 0 ? def.weight : undefined;
  return (
    <div
      data-a2ui-id={id}
      // A brick with nothing to show (an Image without a photo, a Rating without a value) takes no gap.
      className="bb-appear min-w-0 empty:hidden"
      style={weight ? { flexGrow: weight, flexBasis: 0 } : undefined}
    >
      <AncestryContext value={[...ancestors, id]}>
        <BrickBoundary type={def.component} resetKey={def}>
          <Brick def={def} scope={scope} firstSeen={entry.firstSeen} />
        </BrickBoundary>
      </AncestryContext>
    </div>
  );
}

function renderNode(id: string, scope: string, key?: string): ReactNode {
  return <Node key={key ?? id} id={id} scope={scope} />;
}

/** Same footprint as a small surface, so the real one replaces it without a jump (U2/U3). */
function SurfaceSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Building">
      <div className="bb-skeleton h-7 w-2/5" />
      <div className="bb-skeleton h-10 w-full" />
      <div className="bb-skeleton h-10 w-4/5" />
    </div>
  );
}

export function Surface(props: {
  surfaceId: string;
  interactive: boolean;
  onAction: (a: A2uiAction) => void;
}): JSX.Element {
  const { surfaceId, interactive, onAction } = props;
  const surface = useStore((s) => s.surfaces[surfaceId]);
  const streaming = useStore((s) => surfaceStreaming(s, surfaceId));
  const env = useMemo<SurfaceEnv | null>(
    () => (surface ? { surfaceId, surface, interactive, streaming, onAction, renderNode } : null),
    [surfaceId, surface, interactive, streaming, onAction],
  );
  const hasRoot = surface?.components.root !== undefined;

  return (
    <section
      aria-label={"Surface " + surfaceId}
      data-surface-id={surfaceId}
      // U8: older surfaces stay visible as history but cannot be used.
      inert={!interactive}
      className={cn(
        "relative w-full max-w-(--surface-w) rounded-xl border bg-card p-5 text-card-foreground",
        "transition-opacity duration-150 motion-reduce:transition-none",
        !interactive && "opacity-55",
      )}
    >
      {surface?.hasDemoData ? (
        <Badge
          variant="outline"
          className="absolute -top-2.5 right-4 bg-card font-mono text-[0.65rem] tracking-wider text-muted-foreground uppercase"
        >
          demo data
        </Badge>
      ) : null}
      {env && hasRoot ? (
        <SurfaceEnvContext value={env}>
          <Node id="root" scope="/" />
        </SurfaceEnvContext>
      ) : streaming ? (
        <SurfaceSkeleton />
      ) : (
        <p className="font-mono text-[0.8125rem] text-muted-foreground">Stopped before this screen was built.</p>
      )}
    </section>
  );
}
