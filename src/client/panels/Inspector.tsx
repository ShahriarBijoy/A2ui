import { useMemo, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { wireCounts, wireDetail } from "@/format";
import { cn } from "@/lib/utils";
import type { SurfaceState, WireEntry } from "@/state";
import { JsonView } from "./JsonView";
import { useStickToBottom } from "./Thread";

type Props = { wire: WireEntry[]; surface: SurfaceState | null };

export function Inspector({ wire, surface }: Props) {
  return (
    <section aria-label="Inspector" className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center px-4">
        <h2 className="font-mono text-[0.6875rem] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Inspector
        </h2>
      </header>
      <Tabs defaultValue="wire" className="min-h-0 flex-1 gap-0">
        <div className="px-4 pb-3">
          <TabsList className="h-9! w-full">
            <TabsTrigger value="wire" className="font-mono text-[0.75rem] uppercase tracking-[0.12em] data-active:shadow-none">
              Wire
            </TabsTrigger>
            <TabsTrigger value="data" className="font-mono text-[0.75rem] uppercase tracking-[0.12em] data-active:shadow-none">
              Data
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="wire" className="flex min-h-0 flex-col">
          <WireLog wire={wire} />
        </TabsContent>
        <TabsContent value="data" className="flex min-h-0 flex-col">
          <DataPanel surface={surface} />
        </TabsContent>
      </Tabs>
    </section>
  );
}

export function WireLog({ wire }: { wire: WireEntry[] }) {
  const counts = useMemo(() => wireCounts(wire), [wire]);
  const { viewportRef, contentRef } = useStickToBottom({ mode: "log" });
  return (
    <>
      <div className="flex shrink-0 items-center gap-4 border-y px-4 py-2 font-mono text-[0.75rem] tabular-nums text-muted-foreground">
        <span>
          <span className="text-foreground">{counts.messages}</span> messages
        </span>
        <span>
          <span className="text-foreground">{counts.actions}</span> actions
        </span>
        <span className={cn(counts.refused > 0 && "text-destructive")}>
          <span className={cn("font-medium", counts.refused > 0 ? "text-destructive" : "text-foreground")}>
            {counts.refused}
          </span>{" "}
          refused
        </span>
      </div>
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable]">
        {wire.length === 0 ? (
          <p className="px-4 py-6 font-mono text-[0.75rem] leading-relaxed text-muted-foreground">
            Every message the agent sends lands here: data, not code.
          </p>
        ) : (
          <ol ref={contentRef} className="py-1">
            {wire.map((w) => (
              <WireRow key={w.seq} entry={w} />
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

/** Origin badge colours, shared with the stage hood's JSON views. */
export const ORIGIN_BADGE: Record<WireEntry["origin"], string> = {
  llm: "border-input text-foreground",
  data: "border-transparent bg-secondary text-secondary-foreground",
  knob: "border-transparent bg-highlight text-highlight-foreground",
  renderer: "border-input text-muted-foreground",
};

function WireRow({ entry }: { entry: WireEntry }) {
  const [open, setOpen] = useState(false);
  const knob = entry.origin === "knob";
  const refused = entry.kind === "error";
  const detail = wireDetail(entry);
  return (
    <li className={cn(knob && "bg-highlight-soft/45")}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="grid w-full grid-cols-[1.1rem_minmax(0,1fr)_auto] items-baseline gap-x-2 gap-y-0.5 px-3.5 py-1.5 text-left font-mono text-[0.75rem] hover:bg-accent/60 focus-visible:bg-accent/60 focus-visible:outline-none"
      >
        <span aria-label={entry.dir === "down" ? "agent to renderer" : "renderer to agent"} className="text-muted-foreground">
          {entry.dir === "down" ? "↓" : "↑"}
        </span>
        <span className="truncate">
          <span className={cn("font-medium", refused ? "text-destructive" : "text-foreground")}>{entry.kind}</span>
          {entry.surfaceId && <span className="text-muted-foreground"> {entry.surfaceId}</span>}
        </span>
        <span
          className={cn(
            "rounded-[0.3rem] border px-1.5 text-[0.625rem] uppercase leading-[1.5] tracking-[0.08em]",
            refused ? "border-destructive/40 text-destructive" : ORIGIN_BADGE[entry.origin],
          )}
        >
          {entry.origin}
        </span>
        {detail && <span className="col-span-2 col-start-2 truncate text-muted-foreground">{detail}</span>}
      </button>
      {open && (
        <div className="px-3.5 pb-2.5 pl-8">
          <div className="max-h-[26rem] overflow-auto rounded-md border bg-card px-3 py-2">
            <JsonView value={entry.json} className="text-[0.75rem]" />
          </div>
        </div>
      )}
    </li>
  );
}

export function DataPanel({ surface }: { surface: SurfaceState | null }) {
  if (!surface) {
    return (
      <p className="border-t px-4 py-6 font-mono text-[0.75rem] leading-relaxed text-muted-foreground">
        The newest surface's data model shows here.
      </p>
    );
  }
  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-y px-4 py-2 font-mono text-[0.75rem] text-muted-foreground">
        <span>
          surface <span className="text-foreground">{surface.id}</span>
        </span>
        {surface.hasDemoData && (
          <span className="rounded-[0.3rem] border border-input px-1.5 text-[0.625rem] uppercase tracking-[0.08em]">
            demo data
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-gutter:stable]">
        <JsonView value={surface.data} changed={surface.changed} />
      </div>
    </>
  );
}
