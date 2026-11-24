/**
 * Sessions saved in this browser. A snapshot is the per-session part of AppState (thread, surfaces, newest surface,
 * wire log, pool); settings, totals, recordings and the live turn are page-wide and never saved.
 * Everything read back from localStorage is untrusted: a corrupt entry is skipped, never thrown.
 */
import { isPlainObject, type JsonObject, type JsonValue } from "@shared/a2ui";
import { isBrickName, type BrickName } from "@shared/catalog";
import { isIconName, type IconName } from "@shared/icons";
import { MODES, type Mode, type TurnInput, type WidgetName } from "@shared/protocol";
import type {
  AgentItem,
  ComponentEntry,
  FetchMetrics,
  PoolState,
  RouteMetrics,
  SessionMeta,
  SurfaceState,
  ThreadItem,
  TurnMetrics,
  UsageMetrics,
  UserItem,
  WireEntry,
} from "@/state";

export const SESSIONS_KEY = "bb-sessions-v1";
export const MAX_SESSIONS = 20;
export const MAX_WIRE_SAVED = 200;
export const TITLE_MAX = 48;
export const UNTITLED = "New session";

export type SessionSnapshot = {
  meta: SessionMeta;
  thread: ThreadItem[];
  surfaces: Record<string, SurfaceState>;
  newestSurfaceId: string | null;
  wire: WireEntry[];
  pool: PoolState;
};

export type SessionStorage = Pick<Storage, "getItem" | "setItem">;

// ── Title and icon ───────────────────────────────────────────────────────────

/** The first spoken or typed line (a tap only when nothing was said), at most TITLE_MAX characters. */
export function sessionTitle(thread: readonly ThreadItem[]): string {
  const users = thread.filter((i): i is UserItem => i.kind === "user");
  const first = users.find((u) => u.via !== "tap") ?? users[0];
  const text = first ? first.text.replace(/\s+/g, " ").trim() : "";
  if (!text) return UNTITLED;
  return text.length > TITLE_MAX ? text.slice(0, TITLE_MAX - 1).trimEnd() + "…" : text;
}

/** The first Icon brick with a literal, known name on the session's screens, in the order they were built. */
export function sessionIcon(surfaces: Readonly<Record<string, SurfaceState>>): IconName | null {
  for (const surface of Object.values(surfaces)) {
    for (const entry of Object.values(surface.components)) {
      if (entry.status !== "ok") continue;
      // Read loosely: the Icon brick may not be in this build's catalog types.
      const def = entry.def as unknown as { component: string; name?: unknown };
      if (def.component === "Icon" && isIconName(def.name)) return def.name;
    }
  }
  return null;
}

export function countTurns(thread: readonly ThreadItem[]): number {
  let n = 0;
  for (const i of thread) if (i.kind === "agent") n++;
  return n;
}

// ── Validation ───────────────────────────────────────────────────────────────

const VIAS: readonly UserItem["via"][] = ["voice", "text", "tap"];
const STATUSES: readonly AgentItem["status"][] = ["pending", "streaming", "done", "error"];
const WIDGETS: readonly WidgetName[] = ["RestaurantWidget", "FlightSearchWidget"];

const str = (v: unknown): v is string => typeof v === "string";
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function sanitizeUser(raw: { [key: string]: unknown }): UserItem | null {
  const { id, turnId, text, via } = raw;
  if (!str(id) || !str(turnId) || !str(text) || !VIAS.includes(via as UserItem["via"])) return null;
  return { kind: "user", id, turnId, text, via: via as UserItem["via"] };
}

function sanitizeInput(raw: unknown): TurnInput | null {
  if (!isPlainObject(raw)) return null;
  if (raw.type === "utterance" && str(raw.text)) return { type: "utterance", text: raw.text };
  if (raw.type === "action" && isPlainObject(raw.action) && str(raw.action.name)) return raw as TurnInput;
  return null;
}

function sanitizeMetrics(raw: unknown): TurnMetrics | null {
  if (!isPlainObject(raw) || !num(raw.startedAt)) return null;
  const m: TurnMetrics = {
    startedAt: raw.startedAt,
    llmCalled: raw.llmCalled === true,
    refused: num(raw.refused) ? raw.refused : 0,
  };
  const { route, usage, fetches, clientFirstUiMs } = raw;
  if (isPlainObject(route) && str(route.decision) && num(route.ms) && str(route.engine)) m.route = route as RouteMetrics;
  if (isPlainObject(usage) && str(usage.model) && num(usage.compose_ms) && num(usage.output_tokens)) {
    m.usage = usage as UsageMetrics;
  }
  if (Array.isArray(fetches)) {
    const ok = fetches.filter((f) => isPlainObject(f) && str(f.source) && typeof f.ok === "boolean" && num(f.ms));
    if (ok.length > 0) m.fetches = ok as FetchMetrics[];
  }
  if (num(clientFirstUiMs)) m.clientFirstUiMs = clientFirstUiMs;
  return m;
}

function sanitizeAgent(raw: { [key: string]: unknown }): AgentItem | null {
  const { id, turnId, mode, status, replay } = raw;
  if (!str(id) || !str(turnId) || !MODES.includes(mode as Mode) || !STATUSES.includes(status as AgentItem["status"])) {
    return null;
  }
  const metrics = sanitizeMetrics(raw.metrics);
  if (!metrics || !isPlainObject(raw.retry)) return null;
  const input = sanitizeInput(raw.retry.input);
  const { display, via } = raw.retry;
  if (!input || !str(display) || !VIAS.includes(via as UserItem["via"])) return null;
  const item: AgentItem = {
    kind: "agent",
    id,
    turnId,
    mode: mode as Mode,
    // A turn that was still running when the page went away can never finish: show it stopped, never a skeleton.
    status: status === "pending" || status === "streaming" ? "done" : (status as AgentItem["status"]),
    metrics,
    replay: replay === true,
    retry: { input, display, via: via as UserItem["via"] },
  };
  if (str(raw.surfaceId)) item.surfaceId = raw.surfaceId;
  if (str(raw.updatedSurfaceId)) item.updatedSurfaceId = raw.updatedSurfaceId;
  const w = raw.widget;
  if (isPlainObject(w) && WIDGETS.includes(w.name as WidgetName) && isPlainObject(w.props)) {
    item.widget = { name: w.name as WidgetName, props: w.props as JsonObject };
  }
  if (str(raw.text)) item.text = raw.text;
  if (str(raw.html)) item.html = raw.html;
  if (str(raw.caption)) item.caption = raw.caption;
  if (str(raw.error)) item.error = raw.error;
  return item;
}

function sanitizeEntry(id: string, raw: unknown): ComponentEntry | null {
  if (!isPlainObject(raw) || !num(raw.firstSeen)) return null;
  // firstSeen is a performance.now() of the page that wrote it. A flash needs "changed after firstSeen" on one clock,
  // so a restored component counts as seen at this page's start: the "We're six" patch still flashes after a reload.
  const firstSeen = 0;
  if (raw.status === "ok" && isPlainObject(raw.def) && str(raw.def.component) && raw.def.id === id) {
    // A brick this build cannot draw (saved by a newer build) shows as a calm refusal instead of breaking the render.
    if (!isBrickName(raw.def.component)) {
      return { status: "refused", id, component: raw.def.component, reason: "Not in this build", firstSeen };
    }
    return { status: "ok", def: raw.def as unknown as Extract<ComponentEntry, { status: "ok" }>["def"], firstSeen };
  }
  if (raw.status === "refused" && str(raw.component) && str(raw.reason)) {
    return { status: "refused", id, component: raw.component, reason: raw.reason, firstSeen };
  }
  return null;
}

function sanitizeSurface(key: string, raw: unknown): SurfaceState | null {
  if (!isPlainObject(raw) || raw.id !== key || !str(raw.catalogId) || !isPlainObject(raw.components)) return null;
  const components: Record<string, ComponentEntry> = {};
  for (const [id, entry] of Object.entries(raw.components)) {
    const ok = sanitizeEntry(id, entry);
    if (ok) components[id] = ok;
  }
  return {
    id: key,
    catalogId: raw.catalogId,
    turnId: str(raw.turnId) ? raw.turnId : null,
    components,
    data: raw.data === undefined ? {} : (raw.data as JsonValue),
    // performance.now() stamps belong to the page that wrote them; on a new page they would flash forever.
    changed: {},
    hasDemoData: raw.hasDemoData === true,
  };
}

function sanitizeWire(raw: unknown): WireEntry | null {
  if (!isPlainObject(raw)) return null;
  const { seq, t, dir, kind, origin, surfaceId, summary } = raw;
  if (!num(seq) || !num(t) || (dir !== "down" && dir !== "up") || !str(kind) || !str(origin) || !str(surfaceId) || !str(summary)) {
    return null;
  }
  return raw as WireEntry;
}

function sanitizePool(raw: unknown): PoolState {
  const pool: PoolState = { predicted: [], used: [], counts: {} };
  if (!isPlainObject(raw)) return pool;
  if (Array.isArray(raw.used)) pool.used = raw.used.filter((n): n is BrickName => str(n) && isBrickName(n));
  if (isPlainObject(raw.counts)) {
    for (const [name, n] of Object.entries(raw.counts)) if (isBrickName(name) && num(n)) pool.counts[name] = n;
  }
  return pool;
}

/** A snapshot safe to open, or null. Running turns come back stopped; flash stamps are dropped. */
export function sanitizeSnapshot(raw: unknown): SessionSnapshot | null {
  if (!isPlainObject(raw) || !isPlainObject(raw.meta) || !Array.isArray(raw.thread) || !isPlainObject(raw.surfaces)) {
    return null;
  }
  const m = raw.meta;
  if (!str(m.id) || m.id === "" || !num(m.createdAt) || !num(m.updatedAt)) return null;

  const thread: ThreadItem[] = [];
  for (const item of raw.thread) {
    if (!isPlainObject(item)) return null;
    const ok = item.kind === "user" ? sanitizeUser(item) : item.kind === "agent" ? sanitizeAgent(item) : null;
    if (!ok) return null;
    thread.push(ok);
  }

  const surfaces: Record<string, SurfaceState> = {};
  for (const [key, s] of Object.entries(raw.surfaces)) {
    const ok = sanitizeSurface(key, s);
    if (ok) surfaces[key] = ok;
  }
  const newest = str(raw.newestSurfaceId) && surfaces[raw.newestSurfaceId] ? raw.newestSurfaceId : null;
  const wire = Array.isArray(raw.wire)
    ? raw.wire.map(sanitizeWire).filter((w): w is WireEntry => w !== null).slice(-MAX_WIRE_SAVED)
    : [];
  const meta: SessionMeta = {
    id: m.id,
    title: sessionTitle(thread),
    icon: sessionIcon(surfaces) ?? (isIconName(m.icon) ? m.icon : null),
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    turns: countTurns(thread),
  };
  return { meta, thread, surfaces, newestSurfaceId: newest, wire, pool: sanitizePool(raw.pool) };
}

// ── Storage ──────────────────────────────────────────────────────────────────

/** The saved sessions, most recent first. Unreadable storage or a corrupt value gives none; a corrupt entry is skipped. */
export function loadSessions(storage: Pick<Storage, "getItem">): SessionSnapshot[] {
  let text: string | null;
  try {
    text = storage.getItem(SESSIONS_KEY);
  } catch (err) {
    console.error("[sessions] could not read saved sessions; starting fresh", err);
    return [];
  }
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.error("[sessions] saved sessions are not JSON; starting fresh", err);
    return [];
  }
  if (!Array.isArray(raw)) {
    console.error("[sessions] saved sessions are not a list; starting fresh");
    return [];
  }
  const out: SessionSnapshot[] = [];
  const ids = new Set<string>();
  raw.forEach((entry, i) => {
    const snap = sanitizeSnapshot(entry);
    if (!snap) {
      console.warn("[sessions] skipping saved session " + i + ": not a valid session");
      return;
    }
    if (ids.has(snap.meta.id)) return;
    ids.add(snap.meta.id);
    out.push(snap);
  });
  out.sort((a, b) => b.meta.updatedAt - a.meta.updatedAt);
  return out.slice(0, MAX_SESSIONS);
}

/** What is written: the newest wire entries only. */
function forStorage(snap: SessionSnapshot): SessionSnapshot {
  return snap.wire.length > MAX_WIRE_SAVED ? { ...snap, wire: snap.wire.slice(-MAX_WIRE_SAVED) } : snap;
}

/**
 * Writes the sessions (most recent first). When the browser's storage is full, the oldest are left out until the
 * rest fit. False when not even the most recent could be written; the app keeps running either way.
 */
export function saveSessions(storage: Pick<Storage, "setItem">, snaps: readonly SessionSnapshot[]): boolean {
  const list = snaps.slice(0, MAX_SESSIONS).map(forStorage);
  let lastErr: unknown = null;
  for (let n = list.length; n >= 1; n--) {
    try {
      storage.setItem(SESSIONS_KEY, JSON.stringify(list.slice(0, n)));
      if (n < list.length) console.warn("[sessions] browser storage is full; saved the newest " + n + " sessions", lastErr);
      return true;
    } catch (err) {
      lastErr = err;
    }
  }
  if (list.length === 0) {
    try {
      storage.setItem(SESSIONS_KEY, "[]");
      return true;
    } catch (err) {
      lastErr = err;
    }
  }
  console.error("[sessions] could not save sessions; they last until the page reloads", lastErr);
  return false;
}
