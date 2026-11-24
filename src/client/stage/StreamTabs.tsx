import { memo, useMemo } from "react";
import { cn } from "@/lib/utils";
import { ORIGIN_BADGE } from "@/panels/Inspector";
import { useStickToBottom } from "@/panels/Thread";
import type { SurfaceState } from "@/state";
import { jsonTokens, prettyRows, type JsonRow, type Line, type Token, type TokenKind } from "./compact";
import { outlineComponent } from "./outline";
import { streamHeader } from "./run";
import { useTurnView, type TurnView } from "./useTurnView";

/** Syntax colours from the theme tokens: ids dark, types blue, bindings and actions in the accent ink. */
export const TOKEN_CLASS: Record<TokenKind, string> = {
  id: "text-foreground font-medium",
  op: "text-muted-foreground/80",
  type: "text-info font-medium",
  key: "text-muted-foreground",
  str: "text-success",
  num: "text-warning",
  lit: "text-warning",
  bind: "text-highlight-ink",
  call: "text-info",
  action: "text-highlight-ink font-medium",
  path: "text-foreground font-medium",
  punct: "text-muted-foreground/70",
  note: "text-muted-foreground italic",
  error: "text-destructive",
};

export function Tokens({ tokens }: { tokens: readonly Token[] }) {
  return (
    <>
      {tokens.map((tk, i) => (
        <span key={i} className={TOKEN_CLASS[tk.k]}>
          {tk.v}
        </span>
      ))}
    </>
  );
}

export function OriginBadge({ origin }: { origin: keyof typeof ORIGIN_BADGE }) {
  return (
    <span className={cn("rounded-[0.3rem] border px-1.5 text-[0.625rem] leading-[1.6] tracking-[0.08em] uppercase", ORIGIN_BADGE[origin])}>
      {origin === "renderer" ? "client" : origin}
    </span>
  );
}

/** "claude-sonnet-5-5 wrote · A2UI JSON · 9 lines", and what the view below is. */
function StreamHeader({ view, note }: { view: TurnView; note: string }) {
  return (
    <div className="flex shrink-0 flex-col gap-0.5 border-y px-[18px] py-2.5">
      <p className="truncate font-mono text-[0.75rem] text-foreground" title={streamHeader(view.item, view.messages)}>
        {streamHeader(view.item, view.messages)}
      </p>
      <p className="text-[0.75rem] leading-snug text-muted-foreground">{note}</p>
    </div>
  );
}

function Empty({ children }: { children: string }) {
  return <p className="border-t px-[18px] py-6 font-mono text-[0.75rem] leading-relaxed text-muted-foreground">{children}</p>;
}

function nonA2ui(view: TurnView): string | null {
  const item = view.item;
  if (!item || view.messages.length > 0) return null;
  if (item.widget) return "This turn answered with a hand-built widget: no A2UI messages.";
  if (item.html !== undefined) return "This turn answered with an HTML page: no A2UI messages.";
  if (item.text !== undefined) return "This turn answered with text: no A2UI messages.";
  return null;
}

const StreamLine = memo(function StreamLine(props: { line: Line; first: boolean; refused: boolean; surfaceId: string | null }) {
  const { line, first, refused, surfaceId } = props;
  const badge = line.kind === "data" || line.kind === "fetch" ? line.origin : null;
  return (
    <li
      onMouseEnter={() => outlineComponent(surfaceId, line.id ?? null)}
      className={cn(
        "bb-appear grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-baseline gap-x-2 px-3 py-[3px] font-mono text-[0.75rem] leading-[1.55]",
        line.id && "hover:bg-accent/60",
        first && "mt-1 border-t border-border/60 pt-1.5",
        line.origin === "knob" && "bg-highlight-soft/40",
      )}
    >
      <span aria-hidden className="text-right text-muted-foreground/60 tabular-nums select-none">
        {line.n}
      </span>
      <span className="break-words [overflow-wrap:anywhere]">
        <Tokens tokens={line.tokens} />
      </span>
      {refused ? (
        <span className="rounded-[0.3rem] border border-destructive/40 px-1.5 text-[0.625rem] leading-[1.6] tracking-[0.08em] text-destructive uppercase">
          refused
        </span>
      ) : badge ? (
        <OriginBadge origin={badge} />
      ) : (
        <span />
      )}
    </li>
  );
});

function isRefused(surface: SurfaceState | undefined, id: string | undefined): boolean {
  return id !== undefined && surface?.components[id]?.status === "refused";
}

/** One line per component and data write, appended as each message arrives (live turns and replays alike). */
export function JsonStreamTab({ turnId }: { turnId: string | null }) {
  const view = useTurnView(turnId);
  const { viewportRef, contentRef } = useStickToBottom({ mode: "log" });
  if (!view.item) return <Empty>Ask for something: every component the agent writes lands here as one line.</Empty>;
  const other = nonA2ui(view);
  return (
    <>
      <StreamHeader view={view} note="A compact view of the same JSON: one line per component or data write." />
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto pb-2 [overflow-anchor:none] [scrollbar-gutter:stable]">
        {other ? (
          <p className="px-[18px] py-4 font-mono text-[0.75rem] text-muted-foreground">{other}</p>
        ) : view.lines.length === 0 ? (
          <p className="px-[18px] py-4 font-mono text-[0.75rem] text-muted-foreground">Waiting for the first message…</p>
        ) : (
          <ol ref={contentRef} aria-label="JSON stream" onMouseLeave={() => outlineComponent(null, null)} className="py-1">
            {view.lines.map((line, i) => (
              <StreamLine
                key={line.n}
                line={line}
                first={i > 0 && view.lines[i - 1].msg !== line.msg}
                refused={isRefused(view.surface, line.id)}
                surfaceId={view.surfaceId}
              />
            ))}
          </ol>
        )}
      </div>
    </>
  );
}

const JsonRowView = memo(function JsonRowView({ row }: { row: JsonRow }) {
  if (row.kind === "head") {
    return (
      <li className={cn("flex items-center gap-2 px-3 pt-2.5 pb-1 font-mono text-[0.6875rem] text-muted-foreground", row.msg > 0 && "mt-1.5 border-t border-border/60")}>
        <span aria-hidden>{row.origin === "renderer" ? "↑" : "↓"}</span>
        <span className="text-foreground">{row.label}</span>
        <OriginBadge origin={row.origin} />
      </li>
    );
  }
  return (
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] gap-x-2 px-3 font-mono text-[0.71875rem] leading-[1.5]">
      <span aria-hidden className="text-right text-muted-foreground/55 tabular-nums select-none">
        {row.n}
      </span>
      <span className="whitespace-pre-wrap [overflow-wrap:anywhere]">
        <Tokens tokens={jsonTokens(row.text)} />
      </span>
    </li>
  );
});

/** The turn's raw A2UI messages, pretty-printed with line numbers. */
export function JsonTab({ turnId }: { turnId: string | null }) {
  const view = useTurnView(turnId);
  const rows = useMemo(() => prettyRows(view.messages), [view.messages]);
  const { viewportRef, contentRef } = useStickToBottom({ mode: "log" });
  if (!view.item) return <Empty>The raw A2UI messages of the selected turn show here.</Empty>;
  const other = nonA2ui(view);
  return (
    <>
      <StreamHeader view={view} note="The raw A2UI messages the renderer received, one block per message." />
      <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto pb-3 [overflow-anchor:none] [scrollbar-gutter:stable]">
        {other ? (
          <p className="px-[18px] py-4 font-mono text-[0.75rem] text-muted-foreground">{other}</p>
        ) : rows.length === 0 ? (
          <p className="px-[18px] py-4 font-mono text-[0.75rem] text-muted-foreground">Waiting for the first message…</p>
        ) : (
          <ol ref={contentRef} aria-label="A2UI JSON">
            {rows.map((row) => (
              <JsonRowView key={row.kind === "head" ? "h" + row.msg : row.n} row={row} />
            ))}
          </ol>
        )}
      </div>
    </>
  );
}
