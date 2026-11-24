/**
 * The hood's Run tab and run history, built from what the turn measured: TurnMetrics, the wire log's arrival times
 * (performance.now(), the same clock as metrics.startedAt) and the turn's recording (its done event). Pure, so every
 * number here is unit tested; a value that was not measured is null and shows as "–".
 */
import { A2UI_VERSION, isPlainObject } from "@shared/a2ui";
import type { A2uiOrigin, TurnInput } from "@shared/protocol";
import { formatMs, formatSeconds, isTurnFinished } from "@/format";
import type { AgentItem, ThreadItem, TurnRecording, UserItem, WireEntry } from "@/state";
import { jsonChars, type TurnMessage } from "./compact";

/** A turn message with its arrival time in ms since the turn began. */
export type TimedMessage = TurnMessage & { atMs: number | null };

/** The turn's agent-to-renderer messages (and the renderer's refusals of them), in arrival order. */
export function turnMessages(wire: readonly WireEntry[], turnId: string, startedAt: number | null): TimedMessage[] {
  const out: TimedMessage[] = [];
  for (const w of wire) {
    if (w.turnId !== turnId) continue;
    if (w.dir === "up" && w.kind !== "error") continue;
    const atMs = startedAt !== null && Number.isFinite(w.t) && w.t >= startedAt ? w.t - startedAt : null;
    out.push({ msg: w.json, origin: w.dir === "down" ? (w.origin as A2uiOrigin) : "renderer", atMs });
  }
  return out;
}

/** A tap turn starts with the renderer's action: the stream shows what the tap sent before what came back. */
export function withActionInput(input: TurnInput | undefined, messages: readonly TimedMessage[]): TimedMessage[] {
  if (input?.type !== "action") return messages.slice();
  return [{ msg: { version: A2UI_VERSION, action: input.action }, origin: "renderer", atMs: null }, ...messages];
}

/** ms from the turn's start to its done event, when the turn was recorded on this page (replays and live turns). */
export function doneTime(rec: TurnRecording | undefined): number | null {
  const done = rec?.events.find((e) => e.ev.type === "done");
  return done && Number.isFinite(done.t) ? done.t : null;
}

export type StepState = "done" | "running" | "skipped" | "failed";
export type Step = { key: string; label: string; value: string; detail?: string; state: StepState; title?: string };

/** "…" while the turn still runs, "–" once it ended without the value. */
function missing(item: AgentItem): string {
  return isTurnFinished(item) ? "–" : "…";
}

/** Route → First UI → each data fetch → Done. Durations as measured; nothing estimated. */
export function runSteps(item: AgentItem, doneMs: number | null): Step[] {
  const { route, clientFirstUiMs, fetches } = item.metrics;
  const finished = isTurnFinished(item);
  const steps: Step[] = [];
  steps.push(
    route
      ? { key: "route", label: "Route", value: formatMs(route.ms), detail: route.decision, state: "done", title: route.reason || undefined }
      : { key: "route", label: "Route", value: missing(item), state: finished ? "skipped" : "running" },
  );
  steps.push(
    clientFirstUiMs !== undefined
      ? { key: "first", label: "First UI", value: formatSeconds(clientFirstUiMs), state: "done" }
      : { key: "first", label: "First UI", value: missing(item), state: finished ? "skipped" : "running" },
  );
  if (fetches && fetches.length > 0) {
    fetches.forEach((f, i) =>
      steps.push({
        key: "fetch" + i,
        label: f.source,
        value: formatSeconds(f.ms),
        detail: f.ok ? f.records + (f.records === 1 ? " record" : " records") : "failed",
        state: f.ok ? "done" : "failed",
        title: f.query,
      }),
    );
  } else {
    steps.push({ key: "data", label: "Data", value: "–", state: "skipped" });
  }
  steps.push(
    doneMs !== null
      ? { key: "done", label: item.status === "error" ? "Error" : "Done", value: formatSeconds(doneMs), state: item.status === "error" ? "failed" : "done" }
      : { key: "done", label: "Done", value: missing(item), state: finished ? "skipped" : "running" },
  );
  return steps;
}

/** Layout containers: a message of only these draws a frame, not content. */
const CONTAINERS: ReadonlySet<string> = new Set(["Card", "Row", "Column", "List", "Tabs", "Accordion", "Divider"]);

function hasContentComponent(msg: unknown): boolean {
  if (!isPlainObject(msg) || !isPlainObject(msg.updateComponents)) return false;
  const list = msg.updateComponents.components;
  return Array.isArray(list) && list.some((c) => isPlainObject(c) && typeof c.component === "string" && !CONTAINERS.has(c.component));
}

function isDataWrite(m: TurnMessage): boolean {
  return (m.origin === "data" || m.origin === "knob") && isPlainObject(m.msg) && isPlainObject(m.msg.updateDataModel);
}

export type FirstContent = { ms: number; basis: "data" | "value" | "component" };

/**
 * When the screen first showed content, on the client clock: the first live data or decision-model value when the
 * turn has one (that is what fills the screen), else the first component that is not a layout container.
 */
export function firstContent(messages: readonly TimedMessage[]): FirstContent | null {
  const data = messages.find((m) => isDataWrite(m) && m.atMs !== null);
  if (data && data.atMs !== null) return { ms: data.atMs, basis: data.origin === "knob" ? "value" : "data" };
  const comp = messages.find((m) => m.origin !== "renderer" && hasContentComponent(m.msg) && m.atMs !== null);
  return comp && comp.atMs !== null ? { ms: comp.atMs, basis: "component" } : null;
}

export type BigNumber = { key: string; label: string; value: string; caption: string };

/** First screen, first content, done: all three on the client clock, from the moment the turn began. */
export function bigNumbers(item: AgentItem, messages: readonly TimedMessage[], doneMs: number | null): BigNumber[] {
  const firstUi = item.metrics.clientFirstUiMs;
  const content = firstContent(messages);
  return [
    { key: "screen", label: "First screen", value: firstUi !== undefined ? formatSeconds(firstUi) : missing(item), caption: "frame shown" },
    {
      key: "content",
      label: "First content",
      value: content ? formatSeconds(content.ms) : missing(item),
      caption: content ? { data: "first data", value: "first value", component: "first component" }[content.basis] : "content on screen",
    },
    { key: "done", label: "Done", value: doneMs !== null ? formatSeconds(doneMs) : missing(item), caption: "turn finished" },
  ];
}

/** Output tokens per second of compose time, when both were measured. */
export function tokensPerSecond(item: AgentItem): number | null {
  const u = item.metrics.usage;
  if (!u || !Number.isFinite(u.output_tokens) || !Number.isFinite(u.compose_ms) || u.compose_ms <= 0) return null;
  return u.output_tokens / (u.compose_ms / 1000);
}

/** Who wrote the turn's A2UI: the composer model once usage reported it, the decision model for a patch, else nobody named. */
export function writer(item: AgentItem): string | null {
  if (item.metrics.usage?.model) return item.metrics.usage.model;
  if (item.metrics.route?.decision === "patch") return "Decision model";
  return null;
}

/** "claude-sonnet-5-5 wrote · A2UI JSON · 9 lines": one JSONL line per message the renderer received. */
export function streamHeader(item: AgentItem | undefined, messages: readonly TurnMessage[]): string {
  const n = messages.filter((m) => m.origin !== "renderer").length;
  const tail = "A2UI JSON · " + n + (n === 1 ? " line" : " lines");
  const who = item ? writer(item) : null;
  return who ? who + " wrote · " + tail : tail;
}

/** "Composed by claude-sonnet-5-5", "Patched by the decision model", or what is known so far. */
export function runSubtitle(item: AgentItem): string {
  if (item.metrics.route?.decision === "patch") return "Patched by the decision model";
  if (item.metrics.usage?.model) return "Composed by " + item.metrics.usage.model;
  if (!isTurnFinished(item)) return "Composing…";
  return item.status === "error" ? "Stopped with an error" : "No composer call";
}

export type RunStatus = "done" | "streaming" | "error";
export function runStatus(item: AgentItem): RunStatus {
  if (item.status === "error") return "error";
  return item.status === "done" ? "done" : "streaming";
}

export type HistoryRow = {
  turnId: string;
  prompt: string;
  via: UserItem["via"];
  mode: string;
  model: string;
  /** Characters the turn's answer took: its A2UI JSON, widget props, HTML or text. Null when none arrived. */
  written: number | null;
  /** Done time in ms; null when the turn was not recorded on this page (a restored session) or has not ended. */
  tookMs: number | null;
  status: RunStatus;
};

const MODE_LABEL: Readonly<Record<AgentItem["mode"], string>> = { a2ui: "A2UI", widgets: "Widgets", html: "HTML" };

function writtenChars(item: AgentItem, wire: readonly WireEntry[]): number | null {
  if (item.widget) return JSON.stringify(item.widget.props).length;
  if (item.html !== undefined) return item.html.length;
  if (item.text !== undefined) return item.text.length;
  const n = jsonChars(turnMessages(wire, item.turnId, null));
  return n > 0 ? n : null;
}

/** Every turn of the open session, oldest first: what was asked, how it was answered and what it took. */
export function runHistory(
  thread: readonly ThreadItem[],
  wire: readonly WireEntry[],
  recordings: Readonly<Record<string, TurnRecording>>,
): HistoryRow[] {
  const users = new Map<string, UserItem>();
  for (const i of thread) if (i.kind === "user") users.set(i.turnId, i);
  const rows: HistoryRow[] = [];
  for (const item of thread) {
    if (item.kind !== "agent") continue;
    const user = users.get(item.turnId);
    const patch = item.metrics.route?.decision === "patch";
    rows.push({
      turnId: item.turnId,
      prompt: user?.text ?? item.retry.display,
      via: user?.via ?? item.retry.via,
      mode: MODE_LABEL[item.mode] + (patch ? " · patch" : ""),
      model: item.metrics.usage?.model ?? (patch ? item.metrics.route?.engine ?? "decision model" : "–"),
      written: writtenChars(item, wire),
      tookMs: doneTime(recordings[item.turnId]),
      status: runStatus(item),
    });
  }
  return rows;
}

// ── Wireframe ────────────────────────────────────────────────────────────────

export type Box = { id: string; x: number; y: number; w: number; h: number };
export type Fitted = { scale: number; width: number; height: number; rects: Box[] };

/**
 * The surface's component boxes (px, relative to the surface) drawn to one scale inside maxW × maxH. The scale
 * never enlarges, and every rect keeps at least 1 px so a thin brick (a divider) still shows.
 */
export function fitBoxes(boxes: readonly Box[], frame: { w: number; h: number }, maxW: number, maxH: number): Fitted {
  if (!(frame.w > 0) || !(frame.h > 0) || !(maxW > 0) || !(maxH > 0)) return { scale: 0, width: 0, height: 0, rects: [] };
  const scale = Math.min(1, maxW / frame.w, maxH / frame.h);
  const r = (n: number) => Math.round(n * scale * 10) / 10;
  return {
    scale,
    width: r(frame.w),
    height: r(frame.h),
    rects: boxes.map((b) => ({ id: b.id, x: r(b.x), y: r(b.y), w: Math.max(1, r(b.w)), h: Math.max(1, r(b.h)) })),
  };
}

export type ComponentRow = {
  id: string;
  type: string;
  status: "ok" | "refused";
  /** First drawn instance (a List template draws one per item), rounded px; null when not on screen. */
  box: Box | null;
  /** How many times it is drawn. */
  count: number;
};

/** Ids written by the turn's updateComponents messages, in order, without repeats. */
export function writtenIds(messages: readonly TurnMessage[]): string[] {
  const ids: string[] = [];
  for (const m of messages) {
    if (m.origin === "renderer" || !isPlainObject(m.msg) || !isPlainObject(m.msg.updateComponents)) continue;
    const list = m.msg.updateComponents.components;
    if (!Array.isArray(list)) continue;
    for (const c of list) if (isPlainObject(c) && typeof c.id === "string" && !ids.includes(c.id)) ids.push(c.id);
  }
  return ids;
}

/** One row per component id with its type, status and measured box. */
export function componentRows(
  ids: readonly string[],
  components: Readonly<Record<string, { status: "ok"; def: { component: string } } | { status: "refused"; component: string }>>,
  boxes: readonly Box[],
): ComponentRow[] {
  return ids.flatMap((id) => {
    const entry = components[id];
    if (!entry) return [];
    const drawn = boxes.filter((b) => b.id === id);
    const first = drawn[0];
    return [
      {
        id,
        type: entry.status === "ok" ? entry.def.component : entry.component,
        status: entry.status,
        box: first ? { id, x: Math.round(first.x), y: Math.round(first.y), w: Math.round(first.w), h: Math.round(first.h) } : null,
        count: drawn.length,
      },
    ];
  });
}

/** True when two measurements are the same to the pixel, so a re-measure that found nothing new renders nothing. */
export function sameBoxes(a: readonly Box[], b: readonly Box[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((x, i) => {
    const y = b[i];
    return x.id === y.id && Math.round(x.x) === Math.round(y.x) && Math.round(x.y) === Math.round(y.y) && Math.round(x.w) === Math.round(y.w) && Math.round(x.h) === Math.round(y.h);
  });
}
