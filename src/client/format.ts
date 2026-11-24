/**
 * Display helpers for the stage UI. Pure (no React, no store) so they can be unit tested.
 * Everything that turns metrics into text lives here: the turn chip must never print a number
 * that did not arrive in a measured event.
 */
import type { AgentItem, FetchMetrics, SurfaceState, ThreadItem, UserItem, WireEntry } from "./state";

// ── Numbers ──────────────────────────────────────────────────────────────────
/** Latency with its natural unit: "162 ms", "1.8 s", "12 s". */
export function formatMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/** Latency in seconds for the slower stages ("first UI 0.6 s"); tiny values stay in ms so they never read as 0.0 s. */
export function formatSeconds(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "–";
  if (ms < 100) return `${Math.round(ms)} ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 1000)} s`;
}

/** Token counts: "312", "2.1k", "12k", "1.2M". */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "–";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${trimZero((n / 1000).toFixed(1))}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${trimZero((n / 1_000_000).toFixed(1))}M`;
}

function trimZero(s: string): string {
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/** Price level 1..4 → "€".."€€€€". */
export function formatPriceLevel(level: number): string {
  const n = Math.min(4, Math.max(1, Math.round(Number.isFinite(level) ? level : 1)));
  return "€".repeat(n);
}

/** The end of a long transcript, cut at a word boundary, so the newest words stay visible on one line. */
export function tailText(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(text.length - max);
  const space = cut.indexOf(" ");
  return `…${space > 0 && space < 20 ? cut.slice(space) : cut}`;
}

// ── Turn chip ────────────────────────────────────────────────────────────────
export type ChipTone = "muted" | "strong" | "highlight" | "failed";
export type ChipPart = { key: string; text: string; tone: ChipTone; title?: string };

export function isTurnFinished(item: AgentItem): boolean {
  return item.status === "done" || item.status === "error";
}

/** A turn the decision model answered alone: knob patches, no LLM call. */
export function isPatchTurn(item: AgentItem): boolean {
  return item.metrics.route?.decision === "patch";
}

/**
 * The turn chip's segments, measured values only.
 * In-flight stages show "…"; stages that never ran show "–" (route skipped, no LLM call).
 */
export function chipParts(item: AgentItem): ChipPart[] {
  const { route, usage, fetches, clientFirstUiMs, llmCalled, refused } = item.metrics;
  const finished = isTurnFinished(item);
  const parts: ChipPart[] = [];

  if (route) {
    parts.push({ key: "route", text: `route ${formatMs(route.ms)}`, tone: "muted", title: route.reason || undefined });
  } else {
    parts.push({ key: "route", text: finished ? "route –" : "route …", tone: "muted" });
  }

  if (usage) {
    parts.push({ key: "compose", text: `compose ${formatSeconds(usage.compose_ms)}`, tone: "muted" });
  } else if (finished && !llmCalled) {
    // The talk points at this on a patch turn: answered with no LLM behind it. Elsewhere (abort, error) it is just absent.
    parts.push({ key: "compose", text: "compose –", tone: route?.decision === "patch" ? "strong" : "muted" });
  } else if (!finished) {
    parts.push({ key: "compose", text: "compose …", tone: "muted" });
  }

  if (route?.decision === "patch") {
    const n = route.patches;
    parts.push({ key: "patch", text: `decision model · ${n} ${n === 1 ? "value" : "values"}`, tone: "highlight" });
  }

  // One segment per data line: they run in parallel, so a summed or longest time was never measured.
  if (fetches) fetches.forEach((f, i) => parts.push(fetchPart(f, i)));

  if (usage && usage.first_ui_ms !== null) {
    parts.push({ key: "first", text: `first UI ${formatSeconds(usage.first_ui_ms)}`, tone: "muted" });
  }
  if (clientFirstUiMs !== undefined) {
    parts.push({ key: "seen", text: `seen ${formatSeconds(clientFirstUiMs)}`, tone: "muted" });
  }
  if (usage) {
    // The figure is output tokens, so only the searches' output tokens join it.
    const fetchOut = (fetches ?? []).reduce((n, f) => n + finiteCount(f.output_tokens), 0);
    const tok = usage.output_tokens + fetchOut;
    parts.push({
      key: "tok",
      text: `${formatTokens(tok)} tok`,
      tone: "muted",
      title: fetchOut > 0 ? `output tokens: compose ${usage.output_tokens} + data ${fetchOut}` : undefined,
    });
    if (usage.cache_read_tokens) {
      parts.push({ key: "cached", text: `cached ${formatTokens(usage.cache_read_tokens)}`, tone: "muted" });
    }
    parts.push({ key: "model", text: usage.model, tone: "muted" });
  }
  if (route) parts.push({ key: "engine", text: route.engine, tone: "muted" });
  if (refused > 0) parts.push({ key: "refused", text: `${refused} refused`, tone: "strong" });
  return parts;
}

function finiteCount(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** "search 6.2 s · 5 results", or "search failed". The label is the data line's source. */
function fetchPart(f: FetchMetrics, i: number): ChipPart {
  const key = `fetch${i}`;
  if (!f.ok) {
    const why = f.error ? ` · ${f.error}` : "";
    return { key, text: `${f.source} failed`, tone: "failed", title: `${f.query} · ${formatMs(f.ms)}${why}` };
  }
  const n = f.records;
  const results = Number.isFinite(n) && n >= 0 ? ` · ${n} ${n === 1 ? "result" : "results"}` : "";
  const searches = f.searches !== undefined ? ` · ${f.searches} web ${f.searches === 1 ? "search" : "searches"}` : "";
  return {
    key,
    text: `${f.source} ${formatSeconds(f.ms)}${results}`,
    tone: "muted",
    title: `${f.query}${searches}`,
  };
}

// ── Thread timeline ──────────────────────────────────────────────────────────
export type TimelineEntry =
  | { kind: "user"; item: UserItem }
  | { kind: "agent"; item: AgentItem }
  /** A surface no agent item created (DevRunner fixtures, applyA2ui outside a turn). */
  | { kind: "surface"; surfaceId: string };

function surfaceBirth(s: SurfaceState): number {
  let t = Number.POSITIVE_INFINITY;
  for (const c of Object.values(s.components)) if (c.firstSeen < t) t = c.firstSeen;
  return t;
}

/**
 * Thread items in order, with unclaimed surfaces merged in by the time their first component arrived.
 * Without this, fixtures applied from the DevRunner would never appear on the stage.
 */
export function buildTimeline(
  thread: readonly ThreadItem[],
  surfaces: Readonly<Record<string, SurfaceState>>,
): TimelineEntry[] {
  const claimed = new Set<string>();
  const turnStart = new Map<string, number>();
  for (const item of thread) {
    if (item.kind !== "agent") continue;
    if (item.surfaceId) claimed.add(item.surfaceId);
    turnStart.set(item.turnId, item.metrics.startedAt);
  }
  const orphans = Object.values(surfaces)
    .filter((s) => !claimed.has(s.id))
    .map((s) => ({ id: s.id, t: surfaceBirth(s) }))
    .sort((a, b) => (a.t === b.t ? 0 : a.t < b.t ? -1 : 1));

  const out: TimelineEntry[] = [];
  let next = 0;
  for (const item of thread) {
    const t = turnStart.get(item.turnId) ?? Number.POSITIVE_INFINITY;
    while (next < orphans.length && orphans[next].t < t) out.push({ kind: "surface", surfaceId: orphans[next++].id });
    out.push(item.kind === "user" ? { kind: "user", item } : { kind: "agent", item });
  }
  while (next < orphans.length) out.push({ kind: "surface", surfaceId: orphans[next++].id });
  return out;
}

/**
 * The one interactive surface (U8): the store's newest, or — when only fixtures created surfaces —
 * the last surface on the timeline.
 */
export function pickInteractiveSurface(
  timeline: readonly TimelineEntry[],
  surfaces: Readonly<Record<string, SurfaceState>>,
  newestSurfaceId: string | null,
): string | null {
  if (newestSurfaceId && surfaces[newestSurfaceId]) return newestSurfaceId;
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i];
    const id = e.kind === "surface" ? e.surfaceId : e.kind === "agent" ? e.item.surfaceId : undefined;
    if (id && surfaces[id]) return id;
  }
  return null;
}

/** The turn id of a timeline entry; fixture surfaces have none. */
export function entryTurnId(e: TimelineEntry): string | null {
  return e.kind === "surface" ? null : e.item.turnId;
}

/**
 * Turns the stage shows in full; every other turn folds to one line. Open: the newest turn, and the turn that built
 * the interactive surface (a patched screen stays open even when its turn is older). While the newest turn is still
 * running, the screen it is replacing stays open too, so nothing above the stream collapses mid-stream; it folds
 * once the new turn has finished.
 */
export function openTurnIds(timeline: readonly TimelineEntry[], interactiveSurfaceId: string | null): Set<string> {
  const open = new Set<string>();
  let newest: string | null = null;
  for (let i = timeline.length - 1; i >= 0 && newest === null; i--) newest = entryTurnId(timeline[i]);
  if (newest === null) return open;
  open.add(newest);

  let newestRunning = false;
  let previousScreen: string | null = null;
  for (const e of timeline) {
    if (e.kind !== "agent") continue;
    const { item } = e;
    if (item.surfaceId && item.surfaceId === interactiveSurfaceId) open.add(item.turnId);
    if (item.turnId === newest) {
      if (!isTurnFinished(item)) newestRunning = true;
    } else if (item.surfaceId) {
      previousScreen = item.turnId;
    }
  }
  if (newestRunning && previousScreen) open.add(previousScreen);
  return open;
}

// ── Wire log ─────────────────────────────────────────────────────────────────
export type WireCounts = { messages: number; actions: number; refused: number };

/**
 * The wire row's second line: the store's summary without the "<kind> <surfaceId>" the first line already shows.
 * "updateDataModel s2 /booking/guests = 6" → "/booking/guests = 6".
 */
export function wireDetail(entry: Pick<WireEntry, "kind" | "surfaceId" | "summary">): string {
  const { kind, surfaceId, summary } = entry;
  let rest = summary;
  for (const prefix of [`${kind} ${surfaceId}`, kind]) {
    if (prefix && (rest === prefix || rest.startsWith(`${prefix} `))) {
      rest = rest.slice(prefix.length);
      break;
    }
  }
  return rest.replace(/^\s*(·\s*)?/, "");
}

export function wireCounts(wire: readonly WireEntry[]): WireCounts {
  let messages = 0;
  let actions = 0;
  let refused = 0;
  for (const w of wire) {
    if (w.dir === "down") messages++;
    else if (w.kind === "action") actions++;
    else if (w.kind === "error") refused++;
  }
  return { messages, actions, refused };
}
