import { useMemo, useState, type ReactNode } from "react";
import { A2UI_VERSION } from "@shared/a2ui";
import { formatSeconds, formatTokens } from "@/format";
import { cn } from "@/lib/utils";
import { useStore } from "@/store";
import { payloadSizes } from "./compact";
import { outlineComponent, useSurfaceBoxes } from "./outline";
import {
  bigNumbers,
  componentRows,
  doneTime,
  fitBoxes,
  runHistory,
  runStatus,
  wireCharsByTurn,
  runSteps,
  runSubtitle,
  tokensPerSecond,
  writtenIds,
  type ComponentRow,
  type RunStatus,
  type Step,
} from "./run";
import { selectTurn } from "./selection";
import { STAGE_LABEL } from "./styles";
import { useTurnView, type TurnView } from "./useTurnView";

const NUMBER = new Intl.NumberFormat("en");
const WIREFRAME_MAX_H = 200;
/** Layout containers draw as faint outlines in the wireframe, content as filled boxes. */
const CONTAINERS: ReadonlySet<string> = new Set(["Card", "Row", "Column", "List", "Tabs", "Accordion"]);

function Section({ label, aside, children, className }: { label: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("flex flex-col gap-2.5 border-t px-[18px] py-4", className)}>
      <header className="flex items-baseline justify-between gap-3">
        <h3 className={STAGE_LABEL}>{label}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

const STATUS: Record<RunStatus, string> = {
  done: "border-success/30 bg-success-soft text-success",
  streaming: "border-highlight/40 bg-highlight-soft text-highlight-ink",
  error: "border-destructive/30 bg-danger-soft text-destructive",
};

function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <span className={cn("inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2.5 font-mono text-[0.6875rem] tracking-[0.06em] uppercase", STATUS[status])}>
      {status === "streaming" && <span aria-hidden className="size-1.5 rounded-full bg-highlight motion-safe:animate-pulse" />}
      {status}
    </span>
  );
}

function Steps({ steps }: { steps: Step[] }) {
  return (
    <ol aria-label="Steps" className="flex flex-wrap items-center gap-y-2">
      {steps.map((s, i) => (
        <li key={s.key} className="flex items-center">
          {i > 0 && <span aria-hidden className="mx-1 h-px w-2.5 bg-input" />}
          <span
            title={s.title}
            className={cn(
              "flex flex-col gap-0.5 rounded-lg border px-2.5 py-1.5",
              s.state === "done" && "bg-card",
              s.state === "running" && "border-highlight/50 bg-highlight-soft/40",
              s.state === "skipped" && "border-dashed",
              s.state === "failed" && "border-destructive/40 bg-danger-soft/50",
            )}
          >
            <span className="font-mono text-[0.625rem] leading-none tracking-[0.1em] text-muted-foreground uppercase">{s.label}</span>
            <span className="font-mono text-[0.8125rem] leading-tight font-semibold tabular-nums">
              {s.value}
              {s.detail && <span className="ml-1 font-normal text-muted-foreground">{s.detail}</span>}
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

function Payload({ view }: { view: TurnView }) {
  const p = payloadSizes(view.messages, view.lines);
  const usage = view.item?.metrics.usage;
  if (p.messages === 0) return <p className="text-[0.8125rem] text-muted-foreground">No A2UI messages in this turn.</p>;
  const compactPct = p.json > 0 ? Math.max(2, (p.compact / p.json) * 100) : 0;
  return (
    <div className="flex flex-col gap-2">
      <Bar label="A2UI JSON" value={p.json} pct={100} strong />
      <Bar label="Compact lines" value={p.compact} pct={compactPct} />
      <p className="text-[0.8125rem] leading-snug text-muted-foreground">
        {p.ratio !== null && (
          <>
            <span className="font-semibold text-foreground tabular-nums">{p.ratio.toFixed(1)}×</span> shorter as compact lines, same{" "}
            {p.messages} {p.messages === 1 ? "message" : "messages"}
          </>
        )}
        {usage && (
          <span className="block font-mono text-[0.75rem]">
            composed in {formatSeconds(usage.compose_ms)}
            {usage.first_ui_ms !== null && <> · first UI line {formatSeconds(usage.first_ui_ms)}</>}
          </span>
        )}
      </p>
    </div>
  );
}

function Bar({ label, value, pct, strong }: { label: string; value: number; pct: number; strong?: boolean }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-2.5">
      <span className="text-[0.8125rem] text-muted-foreground">{label}</span>
      <span aria-hidden className="h-2 overflow-hidden rounded-full bg-muted/70">
        <span className={cn("block h-full rounded-full", strong ? "bg-foreground/75" : "bg-highlight")} style={{ width: pct + "%" }} />
      </span>
      <span className="font-mono text-[0.75rem] tabular-nums">{NUMBER.format(value)} ch</span>
    </div>
  );
}

function Components({ view }: { view: TurnView }) {
  const [hover, setHover] = useState<string | null>(null);
  const { ref, measure } = useSurfaceBoxes(view.surfaceId);
  const surface = view.surface;
  const written = useMemo(() => writtenIds(view.messages), [view.messages]);
  // A patch writes no components: the table then lists the screen it changed.
  const ids = written.length > 0 ? written : surface ? Object.keys(surface.components) : [];
  const rows = surface ? componentRows(ids, surface.components, measure.boxes) : [];
  const ok = rows.filter((r) => r.status === "ok").length;
  const refused = rows.length - ok;
  const types = new Map(rows.map((r) => [r.id, r]));
  const fitted = measure.frame ? fitBoxes(measure.boxes, measure.frame, measure.panelW, WIREFRAME_MAX_H) : null;
  const point = (id: string | null) => {
    setHover(id);
    outlineComponent(view.surfaceId, id);
  };
  const label = written.length > 0 ? "Components written" : "Components on screen";
  return (
    <Section
      label={label}
      aside={
        <span className="font-mono text-[0.75rem] tabular-nums">
          <span className="font-semibold">{written.length > 0 ? ok + "/" + rows.length : rows.length}</span>
          {refused > 0 && <span className="ml-1.5 text-destructive">{refused} refused</span>}
        </span>
      }
    >
      <div ref={ref} className="w-full">
        {fitted && fitted.rects.length > 0 ? (
          <div
            aria-label="Wireframe of the screen, to scale"
            className="bb-dots relative mx-auto overflow-hidden rounded-md border border-dashed border-input/80 [--bb-dot-gap:10px]"
            style={{ width: fitted.width, height: fitted.height }}
          >
            {fitted.rects.map((r, i) => {
              const row = types.get(r.id);
              const container = row ? CONTAINERS.has(row.type) : true;
              return (
                <span
                  key={r.id + i}
                  aria-hidden
                  className={cn(
                    "absolute rounded-[2px] border transition-colors duration-100 motion-reduce:transition-none",
                    container ? "border-foreground/20" : "border-foreground/40 bg-card/80",
                    row?.status === "refused" && "border-destructive/60 bg-danger-soft/70",
                    hover === r.id && "border-highlight bg-highlight-soft/70",
                  )}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                />
              );
            })}
          </div>
        ) : (
          <p className="rounded-md border border-dashed px-3 py-3 text-[0.8125rem] text-muted-foreground">
            {view.surfaceId ? "Not on screen: open its turn in the thread to measure it." : "This turn has no A2UI screen."}
          </p>
        )}
      </div>
      {rows.length > 0 && (
        <table className="w-full table-fixed font-mono text-[0.6875rem]" onMouseLeave={() => point(null)}>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="w-[22%] pb-1 font-normal">id</th>
              <th className="w-[20%] pb-1 font-normal">type</th>
              <th className="pb-1 text-right font-normal">x,y</th>
              <th className="pb-1 text-right font-normal">w×h</th>
              <th className="w-[3.5rem] pb-1 text-right font-normal">
                <span className="sr-only">status</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <ComponentRowView key={r.id} row={r} active={hover === r.id} onPoint={point} />
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}

function ComponentRowView({ row, active, onPoint }: { row: ComponentRow; active: boolean; onPoint: (id: string | null) => void }) {
  return (
    <tr onMouseEnter={() => onPoint(row.id)} className={cn("border-t border-border/50", active && "bg-highlight-soft/50")}>
      <td className="truncate py-[3px] pr-1 font-medium" title={row.id}>
        {row.id}
        {row.count > 1 && <span className="ml-1 font-normal text-muted-foreground">×{row.count}</span>}
      </td>
      <td className="truncate py-[3px] pr-1 text-info">{row.type}</td>
      <td className="truncate py-[3px] pl-1 text-right text-muted-foreground tabular-nums">{row.box ? row.box.x + "," + row.box.y : "–"}</td>
      <td className="truncate py-[3px] pl-1.5 text-right tabular-nums">{row.box ? row.box.w + "×" + row.box.h : "–"}</td>
      <td className={cn("py-[3px] text-right whitespace-nowrap", row.status === "ok" ? "text-success" : "text-destructive")}>[{row.status}]</td>
    </tr>
  );
}

function Footer({ view, doneMs }: { view: TurnView; doneMs: number | null }) {
  const item = view.item;
  if (!item) return null;
  const tps = tokensPerSecond(item);
  const usage = item.metrics.usage;
  const route = item.metrics.route;
  const facts = [
    tps !== null ? Math.round(tps) + " tok/s" : null,
    usage ? formatTokens(usage.output_tokens) + " output tokens" : null,
    doneMs !== null ? "done " + formatSeconds(doneMs) : null,
  ].filter((x): x is string => x !== null);
  const chips = [route?.engine, usage?.model, "A2UI " + A2UI_VERSION].filter((x): x is string => Boolean(x));
  return (
    <div className="flex flex-col gap-2.5 border-t px-[18px] py-4">
      {facts.length > 0 && (
        <p className="font-mono text-[0.75rem] text-muted-foreground tabular-nums">
          {facts.map((f, i) => (
            <span key={f}>
              {i > 0 && " · "}
              <span className="whitespace-nowrap">{f}</span>
            </span>
          ))}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <span key={c} className="rounded-md border bg-card px-2 py-0.5 font-mono text-[0.6875rem]">
            {c}
          </span>
        ))}
      </div>
    </div>
  );
}

function History({ selected }: { selected: string | null }) {
  const thread = useStore((s) => s.thread);
  const wire = useStore((s) => s.wire);
  const recordings = useStore((s) => s.recordings);
  // Characters per turn change only with the wire; a streamed HTML delta changes the thread, not this.
  const chars = useMemo(() => wireCharsByTurn(wire), [wire]);
  const rows = useMemo(() => runHistory(thread, chars, recordings), [thread, chars, recordings]);
  return (
    <Section label="Run history" aside={<span className="font-mono text-[0.75rem] text-muted-foreground">this session</span>}>
      {rows.length === 0 ? (
        <p className="text-[0.8125rem] text-muted-foreground">Every turn of this session lands here.</p>
      ) : (
        <ol className="-mx-2 flex flex-col">
          <li aria-hidden className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-2 pb-1 font-mono text-[0.625rem] tracking-[0.1em] text-muted-foreground uppercase">
            <span>Prompt · mode · model · written</span>
            <span>Took</span>
          </li>
          {rows.map((r) => (
            <li key={r.turnId}>
              <button
                type="button"
                onClick={() => selectTurn(r.turnId)}
                aria-current={r.turnId === selected ? "true" : undefined}
                className={cn(
                  "grid w-full grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-0.5 rounded-lg px-2 py-1.5 text-left outline-none",
                  "hover:bg-accent/60 focus-visible:ring-3 focus-visible:ring-ring/40",
                  r.turnId === selected && "bg-card ring-1 ring-border",
                )}
              >
                <span className={cn("truncate text-[0.8125rem]", r.via === "tap" && "font-mono text-[0.75rem]")}>{r.prompt}</span>
                <span className="font-mono text-[0.75rem] font-semibold tabular-nums">{r.tookMs !== null ? formatSeconds(r.tookMs) : r.status === "streaming" ? "…" : "–"}</span>
                <span className="col-span-2 truncate font-mono text-[0.6875rem] text-muted-foreground">
                  {r.mode} · {r.model} · {r.written !== null ? NUMBER.format(r.written) + " ch" : "–"}
                  {r.status === "error" && <span className="text-destructive"> · error</span>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </Section>
  );
}

/** The selected turn as a run: its steps and times, payload, the components it wrote, then the session's runs. */
export function RunTab({ turnId }: { turnId: string | null }) {
  const view = useTurnView(turnId);
  const rec = useStore((s) => (turnId ? s.recordings[turnId] : undefined));
  const item = view.item;
  const doneMs = doneTime(rec);
  return (
    // relative: the containing block for anything absolutely placed inside (sr-only text), so it never stretches the page.
    <div className="relative min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      {item ? (
        <>
          <div className="flex flex-col gap-1 border-t px-[18px] pt-4 pb-3.5">
            <div className="flex items-start justify-between gap-3">
              <h3 className="line-clamp-2 text-[0.9375rem] leading-snug font-semibold text-balance">{view.user?.text ?? item.retry.display}</h3>
              <StatusBadge status={runStatus(item)} />
            </div>
            <p className="text-[0.8125rem] text-muted-foreground">{runSubtitle(item)}</p>
          </div>
          <Section label="Steps">
            <Steps steps={runSteps(item, doneMs)} />
          </Section>
          <dl className="grid grid-cols-3 border-t">
            {bigNumbers(item, view.messages, doneMs).map((n) => (
              <div key={n.key} className="flex min-w-0 flex-col gap-1 px-3.5 py-3.5 first:pl-[18px] not-first:border-l">
                <dt className="font-mono text-[0.625rem] leading-tight tracking-[0.1em] text-muted-foreground uppercase">{n.label}</dt>
                <dd className="text-[1.5rem] leading-none font-semibold tracking-tight tabular-nums">{n.value}</dd>
                <dd className="text-[0.6875rem] leading-tight text-muted-foreground">{n.caption}</dd>
              </div>
            ))}
          </dl>
          <Section label="Payload">
            <Payload view={view} />
          </Section>
          <Components view={view} />
          <Footer view={view} doneMs={doneMs} />
        </>
      ) : (
        <p className="border-t px-[18px] py-6 font-mono text-[0.75rem] leading-relaxed text-muted-foreground">
          Each turn's run shows here: its steps, times, payload and the components it wrote.
        </p>
      )}
      <History selected={turnId} />
    </div>
  );
}
