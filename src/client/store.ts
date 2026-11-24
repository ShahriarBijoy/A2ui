/**
 * The client store: implements StoreApi (src/client/state.ts). Every change produces new
 * objects so useStore selectors can compare by reference. Server events enter only through
 * applyTurnEvent, which also records them for replay.
 */
import { useSyncExternalStore } from "react";
import type { A2uiAction, A2uiMessageKind, Action, CatalogComponent, JsonValue } from "@shared/a2ui";
import { A2UI_MESSAGE_KINDS, A2UI_VERSION, isPlainObject } from "@shared/a2ui";
import type { BrickName } from "@shared/catalog";
import { deriveKnobs } from "@shared/knobs";
import { setAt } from "@shared/pointer";
import type { A2uiOrigin, Knob, SurfaceSnapshot, ThreadEntry, TurnInput, TurnRequest } from "@shared/protocol";
import { LIMITS } from "@shared/protocol";
import { resolveActionContext } from "@/a2ui/evaluate";
import { applyMessage, containsDemoData, type ApplyResult } from "@/a2ui/processor";
import {
  countTurns,
  loadSessions,
  MAX_SESSIONS,
  saveSessions,
  sessionIcon,
  sessionTitle,
  UNTITLED,
  type SessionSnapshot,
  type SessionStorage,
} from "@/sessions";
import type { AgentItem, AppState, SessionMeta, StoreApi, SurfaceState, ThreadItem, TurnMetrics, WireEntry } from "@/state";

/** The wire log is for reading on stage; older entries are not needed. */
const WIRE_LIMIT = 400;

const EMPTY_SESSION: SessionMeta = { id: "session", title: UNTITLED, icon: null, createdAt: 0, updatedAt: 0, turns: 0 };

export function initialState(session: SessionMeta = EMPTY_SESSION): AppState {
  return {
    mode: "a2ui",
    decision: true,
    handsFree: false,
    thread: [],
    surfaces: {},
    newestSurfaceId: null,
    activeTurnId: null,
    wire: [],
    pool: { predicted: [], used: [], counts: {} },
    totals: { turns: 0, llmCalls: 0, llmAvoided: 0, inputTokens: 0, outputTokens: 0, refusals: 0 },
    transcript: { final: "", interim: "", listening: false },
    replaying: false,
    recordings: {},
    sessions: [session],
    activeSessionId: session.id,
  };
}

export function compactJson(value: unknown, max = 48): string {
  let s: string;
  try {
    s = JSON.stringify(value) ?? "";
  } catch {
    s = String(value);
  }
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

/** The wire is untrusted at runtime: one malformed usage event must not turn the session totals into NaN. */
function finite(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function omitType<T extends { type: string }>(ev: T): Omit<T, "type"> {
  const copy: Partial<T> = { ...ev };
  delete copy.type;
  return copy as Omit<T, "type">;
}

function guessKind(raw: unknown): A2uiMessageKind | "error" {
  if (!isPlainObject(raw)) return "error";
  return A2UI_MESSAGE_KINDS.find((k) => k in raw) ?? "error";
}

function summarize(raw: unknown, res: ApplyResult): string {
  if (!res.kind || !isPlainObject(raw)) return "rejected · " + (res.errors[0]?.message ?? "invalid message");
  const id = res.surfaceId;
  const body = raw[res.kind];
  switch (res.kind) {
    case "createSurface":
      return "createSurface " + id;
    case "deleteSurface":
      return "deleteSurface " + id;
    case "updateComponents": {
      const n = isPlainObject(body) && Array.isArray(body.components) ? body.components.length : 0;
      let s = "updateComponents " + id + " · " + n + (n === 1 ? " component" : " components");
      if (res.refused > 0) s += " · " + res.refused + " refused";
      return s;
    }
    case "updateDataModel": {
      const path = res.changedPaths[0] ?? "/";
      const value = isPlainObject(body) ? body.value : undefined;
      return "updateDataModel " + id + " " + path + " = " + compactJson(value);
    }
  }
}

function agentSummary(a: AgentItem): string {
  if (a.caption) return a.caption;
  if (a.metrics.route?.decision === "patch") return "changed values in place";
  if (a.status === "error") return "failed: " + (a.error ?? "error");
  switch (a.mode) {
    case "a2ui":
      if (a.surfaceId) return "built surface " + a.surfaceId;
      if (a.updatedSurfaceId) return "updated surface " + a.updatedSurfaceId;
      return "no answer";
    case "widgets":
      if (a.widget) return "showed " + a.widget.name;
      if (a.text) return a.text.length > 120 ? a.text.slice(0, 119) + "…" : a.text;
      return "no answer";
    case "html":
      return a.html ? "built an HTML page" : "no answer";
  }
}

/** Thread for the model: user lines, taps (with their action) and agent summaries, oldest first. */
export function deriveThread(items: readonly ThreadItem[]): ThreadEntry[] {
  const entries: ThreadEntry[] = [];
  for (const item of items) {
    if (item.kind === "agent") {
      entries.push({ role: "agent", text: agentSummary(item) });
      continue;
    }
    // UserItem has no payload; the paired agent item keeps what was sent (for "Try again").
    const agent = items.find((i): i is AgentItem => i.kind === "agent" && i.turnId === item.turnId);
    const input = agent?.retry.input;
    if (item.via === "tap" && input?.type === "action") {
      entries.push({ role: "tap", text: "tapped " + input.action.name + " " + JSON.stringify(input.action.context) });
    } else {
      entries.push({ role: "user", text: input?.type === "utterance" ? input.text : item.text });
    }
  }
  return entries;
}

function snapshot(surface: SurfaceState): SurfaceSnapshot {
  const defs: CatalogComponent[] = [];
  const components: { id: string; component: string }[] = [];
  for (const [id, entry] of Object.entries(surface.components)) {
    if (entry.status !== "ok") continue;
    defs.push(entry.def);
    components.push({ id, component: entry.def.component });
  }
  let knobs: Knob[] = [];
  try {
    knobs = deriveKnobs(defs, surface.data);
  } catch (err) {
    // Knobs only feed the decision model; a turn without them still composes.
    console.error("[store] deriveKnobs failed; sending no knobs", err);
  }
  return { id: surface.id, components, data: surface.data, knobs };
}

function withAgent(thread: ThreadItem[], index: number, agent: AgentItem): ThreadItem[] {
  const next = thread.slice();
  next[index] = agent;
  return next;
}

function findAgentIndex(thread: readonly ThreadItem[], turnId: string): number {
  return thread.findIndex((i) => i.kind === "agent" && i.turnId === turnId);
}

function firstUi(metrics: TurnMetrics, now: number): TurnMetrics {
  return metrics.clientFirstUiMs === undefined ? { ...metrics, clientFirstUiMs: now - metrics.startedAt } : metrics;
}

export type StoreOptions = {
  /** Where sessions are saved. None (the default) keeps them for this page only. */
  storage?: SessionStorage | null;
  /** Wall clock for session times (Date.now). */
  clock?: () => number;
  /** Runs a save after the current event, so saving never delays a render. Default: a 0 ms timer. */
  defer?: (fn: () => void) => void;
};

export function createStore(opts: StoreOptions = {}): StoreApi {
  const storage = opts.storage ?? null;
  const clock = opts.clock ?? (() => Date.now());
  const defer = opts.defer ?? ((fn: () => void) => void setTimeout(fn, 0));
  let state: AppState;
  const listeners = new Set<() => void>();
  let wireSeq = 0;
  let turnSeq = 0;
  let itemSeq = 0;
  let surfaceSeq = 0;
  let sessionSeq = 0;
  /** Every surface id seen this page, so nextSurfaceId never repeats one, even after Esc. */
  const seenSurfaceIds = new Set<string>();
  /** Surfaces of the open session that have been made the newest once; a later root on them is an update, not a new step. */
  const promotedSurfaceIds = new Set<string>();
  /** The sessions that are not open, by id. The open one lives in `state`. */
  const others = new Map<string, SessionSnapshot>();
  /** Turns of a session that was left or deleted while they ran: their late events must land nowhere. */
  const retiredTurns = new Set<string>();

  // ── Sessions ──
  const freshMeta = (): SessionMeta => {
    const now = clock();
    const id = "ses-" + now.toString(36) + "-" + (++sessionSeq).toString(36) + Math.random().toString(36).slice(2, 6);
    return { id, title: UNTITLED, icon: null, createdAt: now, updatedAt: now, turns: 0 };
  };

  const sortSessions = (list: SessionMeta[]): SessionMeta[] => list.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  /** The open session's meta, recomputed from its thread and screens; `touch` marks it as just used. */
  const withOpenMeta = (s: AppState, touch: boolean): AppState => {
    const index = s.sessions.findIndex((m) => m.id === s.activeSessionId);
    const old = index >= 0 ? s.sessions[index] : { ...freshMeta(), id: s.activeSessionId };
    const title = sessionTitle(s.thread);
    const icon = sessionIcon(s.surfaces);
    const turns = countTurns(s.thread);
    const updatedAt = touch ? clock() : old.updatedAt;
    if (index >= 0 && old.title === title && old.icon === icon && old.turns === turns && old.updatedAt === updatedAt) return s;
    const meta: SessionMeta = { ...old, title, icon, turns, updatedAt };
    return { ...s, sessions: sortSessions([meta, ...s.sessions.filter((m) => m.id !== meta.id)]) };
  };

  /** The open session as a snapshot. Leaving it stops its running turns for good. */
  const snapshotOpen = (s: AppState, leaving: boolean): SessionSnapshot => {
    let thread = s.thread;
    if (leaving) {
      if (s.activeTurnId) retiredTurns.add(s.activeTurnId);
      thread = s.thread.map((i) => {
        if (i.kind !== "agent" || (i.status !== "pending" && i.status !== "streaming")) return i;
        retiredTurns.add(i.turnId);
        return { ...i, status: "done" as const };
      });
    }
    const meta = s.sessions.find((m) => m.id === s.activeSessionId) ?? { ...freshMeta(), id: s.activeSessionId };
    return {
      meta: { ...meta, title: sessionTitle(thread), icon: sessionIcon(s.surfaces), turns: countTurns(thread) },
      thread,
      surfaces: s.surfaces,
      newestSurfaceId: s.newestSurfaceId,
      wire: s.wire,
      pool: { predicted: [], used: s.pool.used, counts: s.pool.counts },
    };
  };

  /** `base` with `snap` as the open session. Settings, totals, transcript and recordings stay. */
  const openSnapshot = (snap: SessionSnapshot, base: AppState): AppState => {
    promotedSurfaceIds.clear();
    for (const surface of Object.values(snap.surfaces)) {
      seenSurfaceIds.add(surface.id);
      if (surface.components.root !== undefined) promotedSurfaceIds.add(surface.id);
    }
    return {
      ...base,
      thread: snap.thread,
      surfaces: snap.surfaces,
      newestSurfaceId: snap.newestSurfaceId,
      activeTurnId: null,
      replaying: false,
      wire: snap.wire,
      pool: { predicted: [], used: snap.pool.used, counts: snap.pool.counts },
      activeSessionId: snap.meta.id,
    };
  };

  /** `base` with a fresh empty session open. */
  const openFresh = (base: AppState, meta: SessionMeta): AppState => {
    promotedSurfaceIds.clear();
    return {
      ...base,
      thread: [],
      surfaces: {},
      newestSurfaceId: null,
      activeTurnId: null,
      replaying: false,
      wire: [],
      pool: { predicted: [], used: [], counts: {} },
      activeSessionId: meta.id,
    };
  };

  /** At most MAX_SESSIONS: the oldest go first, never the open one. */
  const capSessions = (list: SessionMeta[], keep: string): SessionMeta[] => {
    const out = list.slice();
    for (let i = out.length - 1; i >= 0 && out.length > MAX_SESSIONS; i--) {
      if (out[i].id === keep) continue;
      others.delete(out[i].id);
      out.splice(i, 1);
    }
    return out;
  };

  let saveQueued = false;
  /** Saves every session after the current event. Never per streamed event: at turn ends and session changes. */
  const save = () => {
    if (!storage || saveQueued) return;
    saveQueued = true;
    defer(() => {
      saveQueued = false;
      try {
        const s = state;
        const open = snapshotOpen(s, false);
        const snaps: SessionSnapshot[] = [];
        for (const m of s.sessions) {
          const snap = m.id === s.activeSessionId ? open : others.get(m.id);
          if (snap) snaps.push(snap);
        }
        saveSessions(storage, snaps);
      } catch (err) {
        // Saving is a convenience; the stage keeps running without it.
        console.error("[sessions] could not save sessions", err);
      }
    });
  };

  /** Restored ids must not collide with this page's: a new "t1" would find the old turn's item. */
  const seedCounters = (snaps: readonly SessionSnapshot[]) => {
    const n = (s: string, re: RegExp) => {
      const m = re.exec(s);
      return m ? Number(m[1]) : 0;
    };
    for (const snap of snaps) {
      for (const item of snap.thread) {
        turnSeq = Math.max(turnSeq, n(item.turnId, /^t(\d+)$/));
        itemSeq = Math.max(itemSeq, n(item.id, /^[ua](\d+)$/));
      }
      for (const w of snap.wire) wireSeq = Math.max(wireSeq, w.seq);
    }
  };

  // Open the most recent saved session, or a fresh one. Storage trouble never stops the app.
  {
    let loaded: SessionSnapshot[] = [];
    if (storage) {
      try {
        loaded = loadSessions(storage);
      } catch (err) {
        console.error("[sessions] could not load saved sessions; starting fresh", err);
        loaded = [];
      }
    }
    seedCounters(loaded);
    const first = loaded[0];
    if (first) {
      for (const snap of loaded.slice(1)) others.set(snap.meta.id, snap);
      state = openSnapshot(first, { ...initialState(first.meta), sessions: loaded.map((s) => s.meta) });
    } else {
      state = initialState(freshMeta());
    }
  }

  const set = (next: AppState) => {
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const wireEntry = (e: Omit<WireEntry, "seq" | "t">): WireEntry => ({ seq: ++wireSeq, t: performance.now(), ...e });
  const appendWire = (wire: WireEntry[], entries: WireEntry[]): WireEntry[] => {
    const next = wire.concat(entries);
    return next.length > WIRE_LIMIT ? next.slice(next.length - WIRE_LIMIT) : next;
  };

  /** Shared by applyTurnEvent and applyA2ui: processor, wire log, pool, refusal totals. */
  const ingest = (
    s: AppState,
    raw: unknown,
    origin: A2uiOrigin,
    turnId: string | null,
    now: number,
  ): { state: AppState; res: ApplyResult; promoted: boolean } => {
    const res = applyMessage(s.surfaces, raw, { now, turnId });
    const entries: WireEntry[] = [
      wireEntry({
        dir: "down",
        kind: res.kind ?? guessKind(raw),
        origin,
        surfaceId: res.surfaceId,
        turnId: turnId ?? undefined,
        summary: summarize(raw, res),
        json: raw,
      }),
    ];
    for (const e of res.errors) {
      entries.push(
        wireEntry({
          dir: "up",
          kind: "error",
          origin: "renderer",
          surfaceId: e.surfaceId,
          turnId: turnId ?? undefined,
          summary: "error " + e.path + " · " + e.message,
          json: { version: A2UI_VERSION, error: e },
        }),
      );
    }

    let pool = s.pool;
    if (res.acceptedTypes.length > 0) {
      const used = s.pool.used.slice();
      const counts = { ...s.pool.counts };
      for (const type of res.acceptedTypes) {
        if (!used.includes(type)) used.push(type);
        counts[type] = (counts[type] ?? 0) + 1;
      }
      pool = { ...s.pool, used, counts };
    }

    let newestSurfaceId = s.newestSurfaceId;
    if (res.created) seenSurfaceIds.add(res.surfaceId);
    // A data-only message to a stray id auto-creates a rootless surface; making it the newest would
    // turn the real one inert behind a skeleton that never resolves. Promote on createSurface or root.
    const surface = res.surfaces[res.surfaceId];
    const promoted =
      surface !== undefined &&
      ((res.kind === "createSurface" && res.created) ||
        (!promotedSurfaceIds.has(res.surfaceId) && surface.components.root !== undefined));
    if (promoted) {
      promotedSurfaceIds.add(res.surfaceId);
      newestSurfaceId = res.surfaceId;
    }
    if (res.kind === "deleteSurface") {
      // A deleted id that comes back is a new step and must be promotable again.
      promotedSurfaceIds.delete(res.surfaceId);
      if (newestSurfaceId === res.surfaceId) newestSurfaceId = null;
    }

    const totals = res.refused > 0 ? { ...s.totals, refusals: s.totals.refusals + res.refused } : s.totals;
    return {
      state: { ...s, surfaces: res.surfaces, wire: appendWire(s.wire, entries), pool, newestSurfaceId, totals },
      res,
      promoted,
    };
  };

  const api: StoreApi = {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    setMode(mode) {
      if (state.mode !== mode) set({ ...state, mode });
    },
    setDecision(on) {
      if (state.decision !== on) set({ ...state, decision: on });
    },
    setHandsFree(on) {
      if (state.handsFree !== on) set({ ...state, handsFree: on });
    },

    clearThread() {
      promotedSurfaceIds.clear();
      set(
        withOpenMeta(
          {
            ...state,
            thread: [],
            surfaces: {},
            newestSurfaceId: null,
            activeTurnId: null,
            // The replay turn's own done/failTurn can no longer find its item after this, so reset here.
            replaying: false,
            wire: [],
            pool: { predicted: [], used: [], counts: {} },
          },
          false,
        ),
      );
      save();
    },

    newSession() {
      if (state.thread.length === 0) return;
      const leaving = snapshotOpen(state, true);
      others.set(leaving.meta.id, leaving);
      const meta = freshMeta();
      const listed = state.sessions.map((m) => (m.id === leaving.meta.id ? leaving.meta : m));
      const sessions = capSessions(sortSessions([meta, ...listed]), meta.id);
      set({ ...openFresh(state, meta), sessions });
      save();
    },

    switchSession(id) {
      if (id === state.activeSessionId) return;
      const target = others.get(id);
      if (!target) return;
      const leaving = snapshotOpen(state, true);
      others.delete(id);
      let sessions: SessionMeta[];
      if (leaving.thread.length > 0) {
        others.set(leaving.meta.id, leaving);
        sessions = state.sessions.map((m) => (m.id === leaving.meta.id ? leaving.meta : m));
      } else {
        // An empty session is not worth keeping once you leave it.
        sessions = state.sessions.filter((m) => m.id !== leaving.meta.id);
      }
      set({ ...openSnapshot(target, state), sessions });
      save();
    },

    deleteSession(id) {
      if (id !== state.activeSessionId) {
        if (!state.sessions.some((m) => m.id === id)) return;
        others.delete(id);
        set({ ...state, sessions: state.sessions.filter((m) => m.id !== id) });
        save();
        return;
      }
      snapshotOpen(state, true);
      const rest = state.sessions.filter((m) => m.id !== id);
      const next = rest.find((m) => others.has(m.id));
      const snap = next ? others.get(next.id) : undefined;
      if (snap) {
        others.delete(snap.meta.id);
        set({ ...openSnapshot(snap, state), sessions: rest });
      } else {
        const meta = freshMeta();
        set({ ...openFresh(state, meta), sessions: [meta] });
      }
      save();
    },

    deleteAllSessions() {
      snapshotOpen(state, true);
      others.clear();
      const meta = freshMeta();
      set({ ...openFresh(state, meta), sessions: [meta] });
      save();
    },

    beginTurn({ input, display, via, replay = false }) {
      const turnId = "t" + ++turnSeq;
      const startedAt = performance.now();
      const user: ThreadItem = { kind: "user", id: "u" + ++itemSeq, turnId, text: display, via };
      const agent: AgentItem = {
        kind: "agent",
        id: "a" + ++itemSeq,
        turnId,
        mode: state.mode,
        status: "pending",
        metrics: { startedAt, llmCalled: false, refused: 0 },
        replay,
        retry: { input, display, via },
      };
      set(
        withOpenMeta(
          {
            ...state,
            thread: [...state.thread, user, agent],
            activeTurnId: turnId,
            pool: { ...state.pool, used: [] },
            // A replay re-shows old numbers; page totals count only turns measured on this page visit.
            totals: replay ? state.totals : { ...state.totals, turns: state.totals.turns + 1 },
            replaying: replay ? true : state.replaying,
            recordings: { ...state.recordings, [turnId]: { display, via, mode: state.mode, events: [] } },
          },
          true,
        ),
      );
      return turnId;
    },

    applyTurnEvent(turnId, ev) {
      if (retiredTurns.has(turnId)) return;
      const index = findAgentIndex(state.thread, turnId);
      if (index < 0) return;
      const now = performance.now();
      let a = state.thread[index] as AgentItem;
      let s = state;

      const rec = s.recordings[turnId];
      if (rec) {
        s = {
          ...s,
          recordings: { ...s.recordings, [turnId]: { ...rec, events: [...rec.events, { t: now - a.metrics.startedAt, ev }] } },
        };
      }

      const streaming = (): AgentItem["status"] => (a.status === "pending" ? "streaming" : a.status);

      switch (ev.type) {
        case "route":
          a = { ...a, metrics: { ...a.metrics, route: omitType(ev) } };
          if (ev.decision === "patch") s = { ...s, totals: { ...s.totals, llmAvoided: s.totals.llmAvoided + 1 } };
          break;
        case "a2ui": {
          const before = s.surfaces;
          const out = ingest(s, ev.msg, ev.origin, turnId, now);
          s = out.state;
          const res = out.res;
          let metrics = a.metrics;
          if (res.refused > 0) metrics = { ...metrics, refused: metrics.refused + res.refused };
          if (ev.origin === "llm") metrics = { ...metrics, llmCalled: true };
          if (res.kind) {
            const prior = before[res.surfaceId];
            if (out.promoted) {
              a = { ...a, surfaceId: res.surfaceId };
            } else if (res.kind !== "deleteSurface" && prior && prior.turnId !== turnId) {
              a = { ...a, updatedSurfaceId: res.surfaceId };
            }
            if (s.surfaces[res.surfaceId]?.components.root) metrics = firstUi(metrics, now);
          }
          a = { ...a, metrics, status: streaming() };
          break;
        }
        case "caption":
          a = { ...a, caption: ev.text };
          break;
        case "widget":
          a = {
            ...a,
            widget: { name: ev.name, props: ev.props },
            metrics: firstUi({ ...a.metrics, llmCalled: true }, now),
            status: streaming(),
          };
          break;
        case "text":
          a = {
            ...a,
            text: (a.text ?? "") + ev.delta,
            metrics: firstUi({ ...a.metrics, llmCalled: true }, now),
            status: streaming(),
          };
          break;
        case "html":
          a = {
            ...a,
            html: (a.html ?? "") + ev.delta,
            metrics: firstUi({ ...a.metrics, llmCalled: true }, now),
            status: streaming(),
          };
          break;
        case "usage":
          a = { ...a, metrics: { ...a.metrics, usage: omitType(ev), llmCalled: true } };
          s = {
            ...s,
            totals: {
              ...s.totals,
              llmCalls: s.totals.llmCalls + 1,
              inputTokens: s.totals.inputTokens + finite(ev.input_tokens),
              outputTokens: s.totals.outputTokens + finite(ev.output_tokens),
            },
          };
          break;
        case "fetch": {
          // A live search is a Claude call. "search" is the only source today; the check keeps any future
          // non-LLM source from counting as one.
          const search = ev.source === "search";
          a = {
            ...a,
            metrics: {
              ...a.metrics,
              fetches: [...(a.metrics.fetches ?? []), omitType(ev)],
              llmCalled: a.metrics.llmCalled || search,
            },
          };
          s = {
            ...s,
            totals: {
              ...s.totals,
              llmCalls: s.totals.llmCalls + (search ? 1 : 0),
              inputTokens: s.totals.inputTokens + finite(ev.input_tokens),
              outputTokens: s.totals.outputTokens + finite(ev.output_tokens),
            },
          };
          // Status untouched: a late fetch never turns a done or failed turn back into streaming.
          break;
        }
        case "error":
          a = { ...a, status: "error", error: ev.message };
          break;
        case "done":
          a = { ...a, status: a.status === "error" ? "error" : "done" };
          if (s.activeTurnId === turnId) s = { ...s, activeTurnId: null };
          if (a.replay) s = { ...s, replaying: false };
          break;
      }

      if (a.replay) {
        // The replayed item still fills its own metrics (the chip shows the originally measured
        // numbers), but session totals and pool use counts must not count the same turn twice.
        s = { ...s, totals: state.totals, pool: { ...s.pool, counts: state.pool.counts } };
      }
      const next: AppState = { ...s, thread: withAgent(s.thread, index, a) };
      if (ev.type !== "done") {
        set(next);
        return;
      }
      set(withOpenMeta(next, true));
      save();
    },

    failTurn(turnId, message) {
      if (retiredTurns.has(turnId)) return;
      const index = findAgentIndex(state.thread, turnId);
      if (index < 0) return;
      const a = state.thread[index] as AgentItem;
      let s = state;
      if (s.activeTurnId === turnId) s = { ...s, activeTurnId: null };
      if (a.replay) s = { ...s, replaying: false };
      // A finished turn stays finished; a server error message beats a later "Connection closed".
      if (a.status === "done" || a.status === "error") {
        set(s);
        return;
      }
      set(withOpenMeta({ ...s, thread: withAgent(s.thread, index, { ...a, status: "error", error: message }) }, true));
      save();
    },

    applyA2ui(msg, origin, turnId) {
      set(ingest(state, msg, origin, turnId ?? null, performance.now()).state);
    },

    setData(surfaceId, path, value) {
      const surface = state.surfaces[surfaceId];
      if (!surface) return;
      let data: JsonValue;
      try {
        data = setAt(surface.data, path, value);
      } catch (err) {
        console.error("[store] setData failed", surfaceId, path, err);
        return;
      }
      set({
        ...state,
        surfaces: { ...state.surfaces, [surfaceId]: { ...surface, data, hasDemoData: containsDemoData(data) } },
      });
    },

    emitAction(surfaceId, sourceComponentId, action: Action, scope) {
      const surface = state.surfaces[surfaceId];
      const context = surface ? resolveActionContext(action, { data: surface.data, scope }) : {};
      const out: A2uiAction = {
        name: action.event.name,
        surfaceId,
        sourceComponentId,
        timestamp: new Date().toISOString(),
        context,
      };
      const entry = wireEntry({
        dir: "up",
        kind: "action",
        origin: "renderer",
        surfaceId,
        summary: "action " + out.name + " · " + compactJson(context),
        json: { version: A2UI_VERSION, action: out },
      });
      set({ ...state, wire: appendWire(state.wire, [entry]) });
      return out;
    },

    addPredicted(names: BrickName[]) {
      const add = names.filter((n, i) => !state.pool.predicted.includes(n) && names.indexOf(n) === i);
      if (add.length === 0) return;
      set({ ...state, pool: { ...state.pool, predicted: [...state.pool.predicted, ...add] } });
    },
    clearPredicted() {
      if (state.pool.predicted.length === 0) return;
      set({ ...state, pool: { ...state.pool, predicted: [] } });
    },

    setTranscript(t) {
      set({ ...state, transcript: { ...state.transcript, ...t } });
    },

    buildTurnRequest(input: TurnInput): TurnRequest {
      const s = state;
      const newest = s.newestSurfaceId ? s.surfaces[s.newestSurfaceId] : undefined;
      let nextSurfaceId: string;
      do {
        nextSurfaceId = "s" + ++surfaceSeq;
      } while (s.surfaces[nextSurfaceId] || seenSurfaceIds.has(nextSurfaceId));
      seenSurfaceIds.add(nextSurfaceId);
      return {
        mode: s.mode,
        decision: s.decision,
        input,
        thread: deriveThread(s.thread).slice(-LIMITS.threadTurns),
        surface: newest ? snapshot(newest) : null,
        nextSurfaceId,
      };
    },
  };
  return api;
}

/**
 * True while a turn that owns the surface, or one that is updating it, is still pending or streaming.
 * Returns a boolean, so it is safe as a useStore selector.
 */
export function surfaceStreaming(s: AppState, surfaceId: string): boolean {
  const owner = s.surfaces[surfaceId]?.turnId ?? null;
  return s.thread.some(
    (i) =>
      i.kind === "agent" &&
      (i.status === "pending" || i.status === "streaming") &&
      (i.turnId === owner || i.surfaceId === surfaceId || i.updatedSurfaceId === surfaceId),
  );
}

function browserStorage(): SessionStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch (err) {
    // Some privacy modes throw on access; sessions then last for the page only.
    console.warn("[sessions] localStorage unavailable; sessions last until the page reloads", err);
    return null;
  }
}

export const store: StoreApi = createStore({ storage: browserStorage() });

/** Selectors must return state slices (stable references), never fresh arrays or objects. */
export function useStore<T>(selector: (s: AppState) => T): T {
  const read = () => selector(store.getState());
  return useSyncExternalStore(store.subscribe, read, read);
}
