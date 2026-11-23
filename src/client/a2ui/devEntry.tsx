/**
 * Standalone dev page (/dev.html): the fixture runner, every surface in the store,
 * the newest surface's data model and the tail of the wire log.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { A2uiAction } from "@shared/a2ui";
import "@/index.css";
import { initDemoKey } from "@/apiBase";
import { useStore } from "@/store";
import DevRunner from "./DevRunner";
import { Surface } from "./Surface";

// Actions are already in the wire log (emitAction); the page keeps them local instead of calling the Worker.
const onAction = (a: A2uiAction) => console.info("[dev] action", a);

function DevPage() {
  const surfaces = useStore((s) => s.surfaces);
  const newestSurfaceId = useStore((s) => s.newestSurfaceId);
  const wire = useStore((s) => s.wire);
  const ids = Object.keys(surfaces);
  const data = newestSurfaceId ? surfaces[newestSurfaceId]?.data : undefined;
  return (
    <div className="grid min-h-svh grid-cols-[minmax(0,30rem)_minmax(0,1fr)] gap-8 p-6">
      <aside className="flex min-w-0 flex-col gap-5">
        <h1 className="font-mono text-xs tracking-wider text-muted-foreground uppercase">Brick Box · dev runner</h1>
        <DevRunner />
        <section className="flex flex-col gap-1.5">
          <h2 className="font-mono text-xs tracking-wider text-muted-foreground uppercase">
            Data · {newestSurfaceId ?? "none"}
          </h2>
          <pre data-testid="data-panel" className="overflow-auto rounded-md border bg-card p-3 font-mono text-xs">
            {JSON.stringify(data ?? null, null, 2)}
          </pre>
        </section>
        <section className="flex flex-col gap-1.5">
          <h2 className="font-mono text-xs tracking-wider text-muted-foreground uppercase">Wire (last 14)</h2>
          <ol data-testid="wire" className="flex flex-col gap-0.5 font-mono text-xs">
            {wire.slice(-14).map((e) => (
              <li key={e.seq} className={e.kind === "error" ? "text-destructive" : undefined}>
                {e.dir === "down" ? "↓ " : "↑ "}
                {e.summary}
              </li>
            ))}
          </ol>
        </section>
      </aside>
      <main className="flex min-w-0 flex-col items-start gap-6">
        {ids.length === 0 ? <p className="text-muted-foreground">No surfaces yet. Run a fixture.</p> : null}
        {ids.map((id) => (
          <Surface key={id} surfaceId={id} interactive={id === newestSurfaceId} onAction={onAction} />
        ))}
      </main>
    </div>
  );
}

initDemoKey();
const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <DevPage />
  </StrictMode>,
);
