import { useMemo, useState } from "react";
import { ActivityIcon, BoxesIcon, CpuIcon, DatabaseIcon } from "lucide-react";
import { BRICKS } from "@shared/catalog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatTokens, wireCounts } from "@/format";
import { cn } from "@/lib/utils";
import { BrickPool } from "@/panels/BrickPool";
import { DataPanel, WireLog } from "@/panels/Inspector";
import type { SessionTotals } from "@/state";
import { useStore } from "@/store";
import { STAGE_LABEL } from "./styles";

type Tab = "bricks" | "wire" | "data";

const TRIGGER =
  "h-8 flex-none gap-1.5 rounded-[9px] border-0 px-3 text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-[0_1px_0_var(--border)] [&_svg:not([class*='size-'])]:size-4";

/** "Under the hood": the brick pool, the wire log and the newest screen's data, over the page totals. */
export function HoodPanel() {
  const [tab, setTab] = useState<Tab>("bricks");
  const wire = useStore((s) => s.wire);
  const pool = useStore((s) => s.pool);
  const totals = useStore((s) => s.totals);
  const surface = useStore((s) => (s.newestSurfaceId ? (s.surfaces[s.newestSurfaceId] ?? null) : null));
  const turn = useStore((s) => s.thread.reduce((n, i) => (i.kind === "agent" ? n + 1 : n), 0));
  const counts = useMemo(() => wireCounts(wire), [wire]);
  return (
    <section className="bb-chrome flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between gap-3 border-b px-[18px]">
        <h2 className="flex items-center gap-2 text-[0.875rem] font-semibold">
          <CpuIcon aria-hidden className="size-[18px]" />
          Under the hood
        </h2>
        {turn > 0 && <span className={STAGE_LABEL}>turn {turn}</span>}
      </header>
      <Tabs value={tab} onValueChange={(v: Tab) => setTab(v)} className="min-h-0 flex-1 gap-0">
        <TabsList className="h-auto! w-full justify-start gap-1 rounded-none bg-transparent px-[18px] pt-3 pb-3">
          <TabsTrigger value="bricks" className={TRIGGER}>
            <BoxesIcon aria-hidden />
            Bricks <Count n={BRICKS.length} />
          </TabsTrigger>
          <TabsTrigger value="wire" className={TRIGGER}>
            <ActivityIcon aria-hidden />
            Wire <Count n={counts.messages} />
          </TabsTrigger>
          <TabsTrigger value="data" className={TRIGGER}>
            <DatabaseIcon aria-hidden />
            Data
          </TabsTrigger>
        </TabsList>
        <TabsContent value="bricks" className="flex min-h-0 flex-col border-t">
          <BrickPool pool={pool} />
        </TabsContent>
        <TabsContent value="wire" className="flex min-h-0 flex-col">
          <WireLog wire={wire} />
        </TabsContent>
        <TabsContent value="data" className="flex min-h-0 flex-col">
          <DataPanel surface={surface} />
        </TabsContent>
      </Tabs>
      <Metrics totals={totals} />
    </section>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-[0.6875rem] font-normal text-muted-foreground/80 tabular-nums">{n}</span>;
}

function Metrics({ totals }: { totals: SessionTotals }) {
  return (
    <dl className="grid shrink-0 grid-cols-3 border-t" aria-label="Totals for this visit">
      <Metric label="Turns" value={String(totals.turns)} />
      <Metric label="LLM calls avoided" value={String(totals.llmAvoided)} mark={totals.llmAvoided > 0} />
      <Metric
        label="Tokens"
        value={formatTokens(totals.inputTokens + totals.outputTokens)}
        title={`in ${formatTokens(totals.inputTokens)} / out ${formatTokens(totals.outputTokens)}`}
      />
    </dl>
  );
}

function Metric({ label, value, mark, title }: { label: string; value: string; mark?: boolean; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between gap-1.5 px-4 py-3.5 not-first:border-l" title={title}>
      <dt className="flex items-start gap-1.5 font-mono text-[0.65625rem] leading-tight tracking-[0.1em] text-muted-foreground uppercase">
        {mark && <span aria-hidden className="mt-[0.2em] size-1.5 shrink-0 rounded-full bg-highlight" />}
        {label}
      </dt>
      <dd className={cn("font-mono text-[1.375rem] leading-none font-semibold tabular-nums")}>{value}</dd>
    </div>
  );
}
