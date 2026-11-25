import { useMemo, useState } from "react";
import { BRICKS } from "@shared/catalog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { COST_TITLE, formatTokens } from "@/format";
import { formatUsd } from "@shared/pricing";
import { cn } from "@/lib/utils";
import { DataPanel } from "@/panels/Inspector";
import type { SessionTotals } from "@/state";
import { useStore } from "@/store";
import { CpuIcon } from "lucide-react";
import { BrickTiles } from "./BrickTiles";
import { outlineComponent } from "./outline";
import { RunTab } from "./RunTab";
import { followNewestTurn, newestAgentTurnId, usePinnedTurnId, useSelectedTurnId } from "./selection";
import { JsonStreamTab, JsonTab } from "./StreamTabs";

type Tab = "bricks" | "stream" | "json" | "run" | "data";

/** A segmented control: five tabs share the panel's width, so all of them stay readable at 340 px. */
const TRIGGER =
  "h-7 min-w-0 flex-auto gap-1 rounded-[7px] border-0 px-2 text-[0.78125rem] font-medium text-muted-foreground hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-[0_1px_0_var(--border),0_0_0_1px_var(--border)] focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring/25 focus-visible:outline-0";

/** "Under the hood": bricks, the selected turn as a JSON stream, raw JSON and a run, and its screen's data. */
export function HoodPanel() {
  const [tab, setTab] = useState<Tab>("bricks");
  const pool = useStore((s) => s.pool);
  const totals = useStore((s) => s.totals);
  const turnId = useSelectedTurnId();
  return (
    <section className="bb-chrome flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-[18px]">
        <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold">
          <CpuIcon aria-hidden className="size-[18px]" />
          Under the hood
        </h2>
        <TurnMark turnId={turnId} />
      </header>
      <Tabs
        value={tab}
        onValueChange={(v: Tab) => {
          // A hovered line or row unmounts with its tab; its outline on the screen goes with it.
          outlineComponent(null, null);
          setTab(v);
        }}
        className="min-h-0 flex-1 gap-0"
      >
        <div className="px-[14px] pt-3 pb-3">
          <TabsList className="h-auto! w-full gap-0.5 rounded-[10px] bg-background/70 p-[3px]">
            <TabsTrigger value="bricks" className={TRIGGER}>
              Bricks <span className="font-mono text-[0.6875rem] font-normal text-muted-foreground/80 tabular-nums">{BRICKS.length}</span>
            </TabsTrigger>
            <TabsTrigger value="stream" className={TRIGGER}>
              JSON stream
            </TabsTrigger>
            <TabsTrigger value="json" className={TRIGGER}>
              JSON
            </TabsTrigger>
            <TabsTrigger value="run" className={TRIGGER}>
              Run
            </TabsTrigger>
            <TabsTrigger value="data" className={TRIGGER}>
              Data
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="bricks" className="flex min-h-0 flex-col">
          <BrickTiles pool={pool} />
        </TabsContent>
        <TabsContent value="stream" className="flex min-h-0 flex-col">
          <JsonStreamTab turnId={turnId} />
        </TabsContent>
        <TabsContent value="json" className="flex min-h-0 flex-col">
          <JsonTab turnId={turnId} />
        </TabsContent>
        <TabsContent value="run" className="flex min-h-0 flex-col">
          <RunTab turnId={turnId} />
        </TabsContent>
        <TabsContent value="data" className="flex min-h-0 flex-col">
          <TurnData turnId={turnId} />
        </TabsContent>
      </Tabs>
      <Metrics totals={totals} />
    </section>
  );
}

/** "Turn 3" while following the newest; a pinned older turn offers the way back. */
function TurnMark({ turnId }: { turnId: string | null }) {
  const pinned = usePinnedTurnId();
  const thread = useStore((s) => s.thread);
  const { index, newest } = useMemo(() => {
    let n = 0;
    let at = 0;
    for (const i of thread) {
      if (i.kind !== "agent") continue;
      n++;
      if (i.turnId === turnId) at = n;
    }
    return { index: at, newest: newestAgentTurnId(thread) };
  }, [thread, turnId]);
  if (!turnId || index === 0) return null;
  const following = pinned === null || turnId === newest;
  return (
    <span className="flex items-center gap-2 font-mono text-[0.75rem] text-muted-foreground">
      <span className={cn(!following && "rounded-[0.3rem] bg-highlight px-1.5 py-px text-highlight-foreground")}>turn {index}</span>
      {!following && (
        <button type="button" onClick={followNewestTurn} className="rounded-md px-1.5 py-0.5 text-foreground underline-offset-2 hover:underline">
          newest →
        </button>
      )}
    </span>
  );
}

/** The data model of the screen the selected turn built or changed; the newest screen before any turn. */
function TurnData({ turnId }: { turnId: string | null }) {
  const surface = useStore((s) => {
    const item = turnId ? s.thread.find((i) => i.kind === "agent" && i.turnId === turnId) : undefined;
    const id = item?.kind === "agent" ? (item.surfaceId ?? item.updatedSurfaceId ?? null) : null;
    const pick = id ?? s.newestSurfaceId;
    return pick ? (s.surfaces[pick] ?? null) : null;
  });
  return <DataPanel surface={surface} />;
}

function Metrics({ totals }: { totals: SessionTotals }) {
  return (
    // Four values in a ~340-420 px panel: Cost ("$0.029") gets the widest share, Turns the narrowest.
    <dl
      className="grid shrink-0 grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.25fr)] border-t"
      aria-label="Totals for this visit"
    >
      <Metric label="Turns" value={String(totals.turns)} />
      <Metric label="LLM calls avoided" value={String(totals.llmAvoided)} mark={totals.llmAvoided > 0} />
      <Metric
        label="Tokens"
        value={formatTokens(totals.inputTokens + totals.outputTokens)}
        title={`in ${formatTokens(totals.inputTokens)} / out ${formatTokens(totals.outputTokens)}`}
      />
      <Metric label="Cost" value={formatUsd(totals.costUsd)} title={COST_TITLE} />
    </dl>
  );
}

function Metric({ label, value, mark, title }: { label: string; value: string; mark?: boolean; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1.5 px-3 py-3.5 not-first:border-l" title={title}>
      <dt className="flex items-start gap-1.5 font-mono text-[0.65625rem] leading-tight tracking-[0.1em] text-muted-foreground uppercase">
        {mark && <span aria-hidden className="mt-[0.2em] size-1.5 shrink-0 rounded-full bg-highlight" />}
        {label}
      </dt>
      <dd className={cn("font-mono text-[1.25rem] leading-none font-semibold whitespace-nowrap tabular-nums")}>{value}</dd>
    </div>
  );
}
