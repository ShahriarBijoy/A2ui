import { memo, useCallback, useMemo, useRef, useState, type ReactNode, type RefCallback } from "react";
import { ArrowDownIcon, KeyboardIcon, MicIcon, MousePointerClickIcon, RotateCcwIcon } from "lucide-react";
import type { CatalogComponent } from "@shared/a2ui";
import { deriveKnobs } from "@shared/knobs";
import { Surface } from "@/a2ui/Surface";
import { Button } from "@/components/ui/button";
import { ThreadWave } from "@/fx/ThreadWave";
import { buildTimeline, isTurnFinished, pickInteractiveSurface } from "@/format";
import { cn } from "@/lib/utils";
import type { AgentItem, SurfaceState, ThreadItem, UserItem } from "@/state";
import { retryTurn, sendAction } from "@/turns";
import { FlightSearchWidget, parseFlightSearchProps } from "@/widgets/FlightSearchWidget";
import { HtmlFrame, HtmlFrameSkeleton } from "@/widgets/HtmlFrame";
import { parseRestaurantProps, RestaurantWidget } from "@/widgets/RestaurantWidget";
import { TurnChip } from "./TurnChip";

type Props = {
  thread: ThreadItem[];
  surfaces: Record<string, SurfaceState>;
  newestSurfaceId: string | null;
  decision: boolean;
  replaying: boolean;
};

const EXAMPLES = [
  "I want dinner after this event, pick a place nearby.",
  "I need to book a flight tomorrow.",
  "Split a 120 euro bill between four, Jonas only had drinks.",
];

export function Thread({ thread, surfaces, newestSurfaceId, decision, replaying }: Props) {
  const timeline = useMemo(() => buildTimeline(thread, surfaces), [thread, surfaces]);
  const interactiveId = pickInteractiveSurface(timeline, surfaces, newestSurfaceId);
  const newest = newestSurfaceId ? surfaces[newestSurfaceId] : undefined;
  const routable = useMemo(() => (newest ? hasKnobs(newest) : false), [newest]);
  // A replayed or re-run turn can re-create a surface id; only its latest creator renders it, so one id never shows twice.
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    for (const item of thread) if (item.kind === "agent" && item.surfaceId) m.set(item.surfaceId, item.id);
    return m;
  }, [thread]);
  const { viewportRef, contentRef, atBottom, scrollToBottom } = useStickToBottom({ mode: "thread" });

  return (
    <section aria-label="Thread" className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-baseline gap-3 px-10 pt-[1.1rem]">
        <h1 className="text-[1.0625rem] font-semibold tracking-tight">Brick Box</h1>
        <p className="truncate text-[0.8125rem] text-muted-foreground">
          Every screen built on the spot from a box of bricks.
        </p>
      </header>
      <div className="relative min-h-0 flex-1">
        <ThreadWave empty={<EmptyView />}>
          <div
            ref={viewportRef}
            className="h-full overflow-y-auto [overflow-anchor:none] [scrollbar-gutter:stable]"
          >
            {timeline.length === 0 ? (
              <EmptyState />
            ) : (
              // During a replay the surfaces stay at full strength for the audience, but taps cannot interfere.
              <div
                ref={contentRef}
                inert={replaying}
                className="mx-auto flex w-full max-w-[46rem] flex-col gap-8 px-10 pt-4 pb-10"
              >
                {timeline.map((e) => {
                  if (e.kind === "user") return <UserLine key={e.item.id} item={e.item} />;
                  if (e.kind === "surface") {
                    return (
                      <div key={`surface-${e.surfaceId}`} className="flex flex-col items-start gap-2">
                        <Surface
                          surfaceId={e.surfaceId}
                          interactive={e.surfaceId === interactiveId}
                          onAction={sendAction}
                        />
                        <p className="font-mono text-[0.75rem] text-muted-foreground">applied directly · {e.surfaceId}</p>
                      </div>
                    );
                  }
                  const item = e.item;
                  const awaitingRoute =
                    item.mode === "a2ui" &&
                    decision &&
                    routable &&
                    item.retry.input.type === "utterance" &&
                    !item.metrics.route;
                  return (
                    <AgentEntry
                      key={item.id}
                      item={item}
                      surfaceExists={item.surfaceId ? item.surfaceId in surfaces : false}
                      surfaceOwned={item.surfaceId ? owners.get(item.surfaceId) === item.id : false}
                      interactive={item.surfaceId !== undefined && item.surfaceId === interactiveId}
                      awaitingRoute={awaitingRoute}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </ThreadWave>
        <button
          type="button"
          onClick={scrollToBottom}
          tabIndex={atBottom ? -1 : 0}
          aria-hidden={atBottom}
          className={cn(
            "absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border bg-card px-3.5 py-1.5 font-mono text-[0.75rem] text-foreground",
            "transition-opacity duration-150 motion-reduce:transition-none hover:bg-accent",
            atBottom ? "pointer-events-none opacity-0" : "opacity-100",
          )}
        >
          <ArrowDownIcon className="size-3.5" />
          newest
        </button>
      </div>
    </section>
  );
}

function hasKnobs(surface: SurfaceState): boolean {
  const defs: CatalogComponent[] = [];
  for (const entry of Object.values(surface.components)) if (entry.status === "ok") defs.push(entry.def);
  try {
    return deriveKnobs(defs, surface.data).length > 0;
  } catch {
    // Same fallback as the store: no knobs means the turn composes, so show the skeleton at once.
    return false;
  }
}

/** The wave's second view: the cleared thread exactly as Thread draws it (same scroller, same gutter), so the
 * hand-back to the live thread after the wave is pixel for pixel. Hidden from assistive tech: it is a picture. */
function EmptyView() {
  return (
    <div aria-hidden inert className="h-full overflow-y-auto [scrollbar-gutter:stable]">
      <EmptyState />
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-10 pb-[8vh]">
      <div className="w-full max-w-[34rem]">
        <h2 className="text-[1.875rem] leading-tight font-semibold tracking-tight text-balance">
          Hold Space and ask for anything.
        </h2>
        <ul className="mt-6 flex flex-col gap-2.5 border-l pl-4">
          {EXAMPLES.map((line) => (
            <li key={line} className="font-mono text-[0.875rem] leading-snug text-muted-foreground">
              “{line}”
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const VIA = {
  voice: { icon: MicIcon, label: "voice" },
  text: { icon: KeyboardIcon, label: "typed" },
  tap: { icon: MousePointerClickIcon, label: "tap" },
} as const;

const UserLine = memo(function UserLine({ item }: { item: UserItem }) {
  const via = VIA[item.via];
  const Icon = via.icon;
  return (
    <div className="bb-appear flex max-w-[85%] flex-col items-end gap-1.5 self-end">
      <span className="flex items-center gap-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground">
        <Icon aria-hidden className="size-3" />
        You · {via.label}
      </span>
      <p
        className={cn(
          "rounded-2xl rounded-tr-md bg-accent px-4 py-2.5 leading-snug break-words",
          item.via === "tap" ? "font-mono text-[0.875rem]" : "text-[1.0625rem]",
        )}
      >
        {item.text}
      </p>
    </div>
  );
});

type AgentProps = {
  item: AgentItem;
  surfaceExists: boolean;
  surfaceOwned: boolean;
  interactive: boolean;
  awaitingRoute: boolean;
};

const AgentEntry = memo(function AgentEntry(props: AgentProps) {
  const { item } = props;
  return (
    <article className="flex flex-col items-start gap-2" data-status={item.status} aria-busy={!isTurnFinished(item)}>
      <AgentBody {...props} />
      {item.status === "error" && <ErrorLine item={item} />}
      {item.mode === "a2ui" ? (
        // Reserved even when empty: the caption lands late and must not push the chip down.
        <p className="min-h-[1.5em] w-full max-w-[560px] truncate text-[0.9375rem] text-muted-foreground">{item.caption}</p>
      ) : (
        item.caption && <p className="w-full max-w-[560px] truncate text-[0.9375rem] text-muted-foreground">{item.caption}</p>
      )}
      <TurnChip item={item} />
    </article>
  );
});

function AgentBody({ item, surfaceExists, surfaceOwned, interactive, awaitingRoute }: AgentProps) {
  const finished = isTurnFinished(item);
  if (item.surfaceId) {
    if (!surfaceExists) return <Note>Surface {item.surfaceId} was removed.</Note>;
    if (!surfaceOwned) return <Note>Surface {item.surfaceId} was rebuilt further down.</Note>;
    return <Surface surfaceId={item.surfaceId} interactive={interactive} onAction={sendAction} />;
  }
  if (item.widget) {
    return item.widget.name === "RestaurantWidget" ? (
      <RestaurantWidget {...parseRestaurantProps(item.widget.props)} />
    ) : (
      <FlightSearchWidget {...parseFlightSearchProps(item.widget.props)} />
    );
  }
  if (item.text !== undefined) return <TextReply text={item.text} />;
  if (item.html !== undefined) return <HtmlFrame html={item.html} streaming={!finished} />;
  if (item.updatedSurfaceId) return <InPlaceLine surfaceId={item.updatedSurfaceId} />;
  if (!finished) {
    // A likely knob edit gets a line the same height as "updated in place", so the beat where values
    // change on the surface above happens with nothing below it growing or collapsing.
    if (awaitingRoute || item.metrics.route?.decision === "patch") return <InPlaceLine pending />;
    if (item.mode === "html") return <HtmlFrameSkeleton />;
    if (item.mode === "widgets") return <WidgetSkeleton />;
    return <SurfaceSkeleton />;
  }
  if (item.status === "error") return null;
  return <Note>No screen this turn.</Note>;
}

function InPlaceLine({ surfaceId, pending = false }: { surfaceId?: string; pending?: boolean }) {
  return (
    <p className="flex h-10 items-center gap-2 rounded-lg border bg-card/50 px-3.5 font-mono text-[0.8125rem] text-muted-foreground">
      {pending ? (
        <>
          <span aria-hidden className="size-1.5 rounded-full bg-foreground/40 motion-safe:animate-pulse" />
          deciding…
        </>
      ) : (
        <>
          <span aria-hidden className="text-foreground">
            ↺
          </span>
          <span>
            <span className="text-foreground">{surfaceId}</span> updated in place
          </span>
        </>
      )}
    </p>
  );
}

/** Same frame as a surface before its root arrives (U2): the turn shows up at once, before any network. */
function SurfaceSkeleton() {
  // Mirrors Surface's pre-root frame (a2ui/Surface.tsx) class for class, so the swap is invisible.
  return (
    <div className="relative w-full max-w-[560px] rounded-xl border bg-card p-5 text-card-foreground">
      <div className="flex flex-col gap-3" aria-busy="true" aria-label="Building">
        <div className="bb-skeleton h-7 w-2/5" />
        <div className="bb-skeleton h-10 w-full" />
        <div className="bb-skeleton h-10 w-4/5" />
      </div>
    </div>
  );
}

function WidgetSkeleton() {
  return (
    <div aria-label="Waiting for the widget" className="w-full max-w-[560px] rounded-xl border bg-card">
      <div className="border-b px-5 py-3.5">
        <div className="bb-skeleton h-5 w-1/3" />
      </div>
      <div className="flex flex-col gap-3 px-5 py-4">
        <div className="bb-skeleton h-4 w-3/4" />
        <div className="bb-skeleton h-4 w-2/3" />
        <div className="bb-skeleton h-4 w-1/2" />
      </div>
    </div>
  );
}

function TextReply({ text }: { text: string }) {
  return (
    <div className="w-full max-w-[560px]">
      <p className="mb-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-muted-foreground">
        no widget fits · text reply
      </p>
      <div className="rounded-xl border bg-card px-5 py-4 text-[0.9375rem] leading-relaxed whitespace-pre-wrap">{text}</div>
    </div>
  );
}

function ErrorLine({ item }: { item: AgentItem }) {
  return (
    <div
      role="alert"
      className="flex w-full max-w-[560px] items-center gap-3 rounded-lg border border-destructive/30 bg-card py-1.5 pr-1.5 pl-3.5 text-[0.875rem]"
    >
      <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
      <span className="min-w-0 flex-1 truncate text-destructive" title={item.error}>
        {item.error ?? "Something went wrong."}
      </span>
      <Button size="sm" variant="outline" onClick={() => retryTurn(item.id)}>
        <RotateCcwIcon data-icon="inline-start" />
        Try again
      </Button>
    </div>
  );
}

function Note({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[0.8125rem] text-muted-foreground">{children}</p>;
}

// ── Stick to bottom (U8) ─────────────────────────────────────────────────────
const NEAR_BOTTOM_PX = 48;

/**
 * Keeps a scroll view pinned to its newest content while the reader is at the bottom.
 * - "thread": content growth (a streaming surface) follows only while pinned; a new last child (a turn the
 *   user just started) re-pins even after scrolling up.
 * - "log": only a newly appended entry scrolls, and only while pinned. Other growth (a row expanding) never
 *   scrolls; it just re-reads whether the reader is still at the bottom, so the row stays under the pointer.
 * Callback refs instead of effects: setup happens exactly when the nodes attach.
 */
export function useStickToBottom({ mode }: { mode: "thread" | "log" }): {
  viewportRef: RefCallback<HTMLDivElement>;
  contentRef: RefCallback<HTMLElement>;
  atBottom: boolean;
  scrollToBottom: () => void;
} {
  const [atBottom, setAtBottom] = useState(true);
  const live = useRef<{ viewport: HTMLDivElement | null; follow: boolean; last: Element | null; top: number }>({
    viewport: null,
    follow: true,
    last: null,
    top: 0,
  });

  const viewportRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    live.current.viewport = el;
    // Scroll events arrive a frame late, when more content may already have landed; judging "at the bottom"
    // then would drop follow during fast streaming. Only an upward move means the reader left the bottom.
    const onScroll = () => {
      const top = el.scrollTop;
      const near = el.scrollHeight - top - el.clientHeight < NEAR_BOTTOM_PX;
      if (near) live.current.follow = true;
      else if (top < live.current.top) live.current.follow = false;
      live.current.top = top;
      setAtBottom(near);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (live.current.viewport === el) live.current.viewport = null;
    };
  }, []);

  const contentRef = useCallback(
    (el: HTMLElement | null) => {
      if (!el) return;
      live.current.last = null;
      const observer = new ResizeObserver(() => {
        const vp = live.current.viewport;
        if (!vp) return;
        // The last child's identity, not the count: the store caps the wire log, so its length stops growing.
        const appended = el.lastElementChild !== null && el.lastElementChild !== live.current.last;
        live.current.last = el.lastElementChild;
        if (mode === "thread") {
          if (appended) live.current.follow = true;
          if (live.current.follow) vp.scrollTop = vp.scrollHeight;
          return;
        }
        if (appended && live.current.follow) {
          vp.scrollTop = vp.scrollHeight;
          return;
        }
        // A row opened or closed: the view stays put, and "following" holds only if the bottom is still in view.
        const near = vp.scrollHeight - vp.scrollTop - vp.clientHeight < NEAR_BOTTOM_PX;
        live.current.follow = near;
        setAtBottom(near);
      });
      observer.observe(el);
      return () => observer.disconnect();
    },
    [mode],
  );

  const scrollToBottom = useCallback(() => {
    const vp = live.current.viewport;
    if (!vp) return;
    live.current.follow = true;
    vp.scrollTop = vp.scrollHeight;
  }, []);

  return { viewportRef, contentRef, atBottom, scrollToBottom };
}
