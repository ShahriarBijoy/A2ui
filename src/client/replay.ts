/**
 * Replay, the offline fallback (PLAN §8 step 12). Shift+R saves the newest finished turn's recording to
 * localStorage; F1..F6 play recordings back through store.beginTurn + applyTurnEvent (the single ingress) with
 * their original timing, marked as replay.
 *
 * Keys: shipped recordings (replays.json) keep F1 onward, so the stage machine always has the same keys.
 * Saves in this browser fill the keys after them, newest win, in the order they were saved.
 *
 * createReplayer takes its store, timers, clock and storage as arguments so tests can drive it.
 */
import { useSyncExternalStore } from "react";
import { isPlainObject } from "@shared/a2ui";
import type { Mode, TurnEvent, TurnInput } from "@shared/protocol";
import { MODES } from "@shared/protocol";
import type { AgentItem, StoreApi, TurnRecording, UserItem } from "@/state";
import { store } from "@/store";
import { abortTurn } from "@/turns";
import shippedJson from "./replays.json";

/** A saved turn: the store's recording plus what was sent, which the recording does not keep. */
export type Recording = TurnRecording & { input: TurnInput };
export type ReplayStorage = Pick<Storage, "getItem" | "setItem">;

export const SLOT_COUNT = 6;
export const SAVED_LIMIT = 12;
export const STORAGE_KEY = "bb-replays-v1";
/** How long "Saved to F3" and similar notes stay up. "Replaying F2" stays for the whole replay. */
export const NOTE_MS = 2500;

const VIAS: readonly UserItem["via"][] = ["voice", "text", "tap"];

// ── Validation (localStorage and replays.json are both outside the type system) ──

function parseInput(raw: unknown, display: string): TurnInput {
  if (isPlainObject(raw)) {
    if (raw.type === "utterance" && typeof raw.text === "string") return { type: "utterance", text: raw.text };
    if (raw.type === "action" && isPlainObject(raw.action) && typeof raw.action.name === "string") {
      return raw as TurnInput;
    }
  }
  // Only "Try again" and the model's thread read the input; the display line is the best stand-in.
  return { type: "utterance", text: display };
}

function parseRecording(raw: unknown): Recording | string {
  if (!isPlainObject(raw)) return "not an object";
  const { display, via, mode, events } = raw;
  if (typeof display !== "string") return "display is not a string";
  if (!VIAS.includes(via as UserItem["via"])) return "via is not voice, text or tap";
  if (!MODES.includes(mode as Mode)) return "mode is not a2ui, widgets or html";
  if (!Array.isArray(events)) return "events is not an array";
  const out: Recording["events"] = [];
  let last = 0;
  for (const [i, e] of events.entries()) {
    if (!isPlainObject(e) || typeof e.t !== "number" || !Number.isFinite(e.t)) return "event " + i + " has no time";
    if (!isPlainObject(e.ev) || typeof e.ev.type !== "string") return "event " + i + " has no type";
    // Times never run backwards, so the player can walk the list in order.
    last = Math.max(last, e.t);
    // Same trust as the SSE stream (turns.ts parseTurnEvent): the store and the processor validate the rest.
    out.push({ t: last, ev: e.ev as TurnEvent });
  }
  return { display, via: via as UserItem["via"], mode: mode as Mode, input: parseInput(raw.input, display), events: out };
}

/** The valid recordings in `raw`; anything else is dropped with a warning naming `source`. */
export function parseRecordings(raw: unknown, source: string): Recording[] {
  if (!Array.isArray(raw)) {
    console.error("[replay] " + source + " is not an array; no recordings from it");
    return [];
  }
  const out: Recording[] = [];
  raw.forEach((entry, i) => {
    const parsed = parseRecording(entry);
    if (typeof parsed === "string") console.warn("[replay] dropping " + source + " entry " + i + ": " + parsed);
    else out.push(parsed);
  });
  return out;
}

/** Shipped recordings, filled by the controller after rehearsal from exportReplays(). */
export const BUILTIN_REPLAYS: Recording[] = parseRecordings(shippedJson as unknown, "replays.json");

/** Shipped recordings keep their keys; saves fill the keys left, newest win, in the order they were saved. */
export function slotList(shipped: readonly Recording[], saved: readonly Recording[]): Recording[] {
  const fixed = shipped.slice(0, SLOT_COUNT);
  const free = SLOT_COUNT - fixed.length;
  return free > 0 ? [...fixed, ...saved.slice(-free)] : fixed;
}

/**
 * True when the recording starts a sequence (F1 dinner, F4 flight): it creates the first surface, "s1". Such a replay
 * opens a fresh session when the open one already has turns, so the two scenarios never share a thread.
 */
export function startsSequence(rec: Pick<Recording, "events">): boolean {
  return rec.events.some((e) => {
    if (e.ev.type !== "a2ui") return false;
    const msg: unknown = e.ev.msg;
    return isPlainObject(msg) && isPlainObject(msg.createSurface) && msg.createSurface.surfaceId === "s1";
  });
}

/** Recorded events up to the first done, ending in a done even when the stream never sent one (failTurn is not recorded). */
export function playableEvents(events: readonly Recording["events"][number][]): Recording["events"] {
  const end = events.findIndex((e) => e.ev.type === "done");
  if (end >= 0) return events.slice(0, end + 1);
  const t = events.length > 0 ? events[events.length - 1].t : 0;
  return [...events, { t, ev: { type: "done" } }];
}

function loadSaved(storage: ReplayStorage | null): Recording[] {
  if (!storage) return [];
  let text: string | null;
  try {
    text = storage.getItem(STORAGE_KEY);
  } catch (err) {
    console.error("[replay] could not read saved replays", err);
    return [];
  }
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    console.error("[replay] saved replays are not JSON; starting with none", err);
    return [];
  }
  return parseRecordings(raw, "localStorage " + STORAGE_KEY).slice(-SAVED_LIMIT);
}

/** Stores as many of the newest recordings as fit. False when not even the newest could be stored. */
function persist(storage: ReplayStorage | null, list: readonly Recording[]): boolean {
  if (!storage) return false;
  let lastErr: unknown = null;
  for (let start = 0; start < Math.max(1, list.length); start++) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(list.slice(start)));
      if (start > 0) console.warn("[replay] browser storage is full; kept the newest " + (list.length - start), lastErr);
      return true;
    } catch (err) {
      lastErr = err;
    }
  }
  console.error("[replay] could not store the saved replays; they last until the page reloads", lastErr);
  return false;
}

// ── Player ───────────────────────────────────────────────────────────────────

export type ReplayDeps = {
  store: Pick<StoreApi, "getState" | "subscribe" | "beginTurn" | "applyTurnEvent" | "setMode">;
  /** Stops the live turn in flight (turns.abortTurn). */
  abortLiveTurn: () => void;
  /** Opens a fresh session when the open one has turns (store.newSession). Called before a sequence start plays. */
  newSessionIfBusy: () => void;
  shipped: readonly Recording[];
  storage: ReplayStorage | null;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /** Runs `fn` after the current store notification (queueMicrotask). */
  defer?: (fn: () => void) => void;
};

export type Replayer = {
  /** F1..F6. False when the slot is empty. */
  play(slot: number): boolean;
  /** Esc: ends a running replay where it stands (its item ends as done) and clears its timer. */
  cancel(): void;
  /** Shift+R: the newest finished live turn. Returns its F-key, or null when it has none or nothing was saved. */
  save(): number | null;
  /** Saved turns (not the shipped ones) as JSON for src/client/replays.json. */
  exportJson(): string;
  saved(): readonly Recording[];
  slots(): Recording[];
  isPlaying(): boolean;
  /** Feedback for the bottom bar ("Saved to F3 · …", "Replaying F2 · …"), or null. */
  getNote(): string | null;
  subscribeNote(listener: () => void): () => void;
  /** Sets a short note (used by the app for clipboard results). */
  notify(text: string): void;
};

type Run = {
  slot: number;
  turnId: string;
  events: Recording["events"];
  next: number;
  startedAt: number;
  timer: unknown;
  unsubscribe: () => void;
};

export function createReplayer(deps: ReplayDeps): Replayer {
  const st = deps.store;
  const now = deps.now ?? (() => performance.now());
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const defer = deps.defer ?? ((fn: () => void) => queueMicrotask(fn));

  let saved = loadSaved(deps.storage);
  /** Turns saved this session, so a second Shift+R does not fill a second key with the same turn. */
  const savedTurns = new Map<string, Recording>();
  let run: Run | null = null;

  let note: string | null = null;
  let noteTimer: unknown;
  const noteListeners = new Set<() => void>();
  const setNote = (text: string | null, holdMs: number | null) => {
    clearTimer(noteTimer);
    noteTimer = undefined;
    note = text;
    if (text !== null && holdMs !== null) {
      noteTimer = setTimer(() => {
        noteTimer = undefined;
        note = null;
        for (const l of [...noteListeners]) l();
      }, holdMs);
    }
    for (const l of [...noteListeners]) l();
  };

  const slots = () => slotList(deps.shipped, saved);

  const apply = (turnId: string, ev: TurnEvent) => {
    try {
      st.applyTurnEvent(turnId, ev);
    } catch (err) {
      // One bad event must not strand the replay with `replaying` on (the thread stays inert until it ends).
      console.error("[replay] applying a recorded " + ev.type + " event failed; continuing", err);
    }
  };

  /** Stops timers and watching. The turn's item is left as it is. */
  const stop = (r: Run) => {
    if (run === r) run = null;
    clearTimer(r.timer);
    r.timer = undefined;
    r.unsubscribe();
  };

  const schedule = (r: Run) => {
    if (r.next >= r.events.length) return;
    // Absolute offsets from the start, so timer lateness never adds up over a long turn.
    const delay = Math.max(0, r.startedAt + r.events[r.next].t - now());
    r.timer = setTimer(() => tick(r), delay);
  };

  const tick = (r: Run) => {
    r.timer = undefined;
    if (run !== r) return;
    const due = now() - r.startedAt;
    while (run === r && r.next < r.events.length && r.events[r.next].t <= due) {
      const { ev } = r.events[r.next++];
      if (r.next === r.events.length) {
        // The last event is the done: stop watching first, or its own activeTurnId change reads as a takeover.
        stop(r);
        setNote(null, null);
      }
      apply(r.turnId, ev);
    }
    if (run === r) schedule(r);
  };

  /** Esc, a live turn (voice, text, tap, retry) or the dev runner took over: stop without touching the new turn. */
  const watch = (r: Run) => {
    if (run !== r) return;
    const s = st.getState();
    const item = s.thread.find((i): i is AgentItem => i.kind === "agent" && i.turnId === r.turnId);
    if (item && s.activeTurnId === r.turnId) return;
    stop(r);
    setNote(null, null);
    if (item && (item.status === "pending" || item.status === "streaming")) {
      // After this notification, like waveControl: ending the item turns `replaying` off so the thread is live again.
      defer(() => apply(r.turnId, { type: "done" }));
    }
  };

  /** A sequence (F1 build, F2 tap) must play onto finished surfaces, so a replay still running completes at once. */
  const fastForward = (r: Run) => {
    stop(r);
    while (r.next < r.events.length) apply(r.turnId, r.events[r.next++].ev);
  };

  return {
    play(slot) {
      const rec = slots()[slot - 1];
      if (!rec) {
        setNote("F" + slot + " is empty", NOTE_MS);
        return false;
      }
      if (run) fastForward(run);
      deps.abortLiveTurn();
      // After the running replay and live turn are finished, so the session being left keeps them whole.
      if (startsSequence(rec)) deps.newSessionIfBusy();
      // beginTurn stamps the current mode on the item; a widgets or html recording must render as one.
      if (st.getState().mode !== rec.mode) st.setMode(rec.mode);
      const turnId = st.beginTurn({ input: rec.input, display: rec.display, via: rec.via, replay: true });
      const r: Run = {
        slot,
        turnId,
        events: playableEvents(rec.events),
        next: 0,
        startedAt: now(),
        timer: undefined,
        unsubscribe: () => {},
      };
      run = r;
      // Subscribed after our own beginTurn, so only a later turn or a clear reads as a takeover.
      r.unsubscribe = st.subscribe(() => watch(r));
      setNote("Replaying F" + slot + " · " + rec.display, null);
      schedule(r);
      return true;
    },

    cancel() {
      const r = run;
      if (!r) return;
      stop(r);
      setNote(null, null);
      apply(r.turnId, { type: "done" });
    },

    save() {
      const s = st.getState();
      let item: AgentItem | undefined;
      for (let i = s.thread.length - 1; i >= 0; i--) {
        const it = s.thread[i];
        if (it.kind === "agent" && !it.replay && it.status === "done" && (s.recordings[it.turnId]?.events.length ?? 0) > 0) {
          item = it;
          break;
        }
      }
      if (!item) {
        setNote("Nothing to save: finish a turn first", NOTE_MS);
        return null;
      }
      const known = savedTurns.get(item.turnId);
      if (known && saved.includes(known)) {
        const slot = slots().indexOf(known) + 1;
        setNote((slot > 0 ? "Already saved to F" + slot : "Already saved") + " · " + known.display, NOTE_MS);
        return slot > 0 ? slot : null;
      }
      const rec = s.recordings[item.turnId];
      const entry: Recording = {
        display: rec.display,
        via: rec.via,
        mode: rec.mode,
        input: item.retry.input,
        // Whole milliseconds: the timing is what matters, and the export stays readable.
        events: rec.events.map((e) => ({ t: Math.round(e.t), ev: e.ev })),
      };
      saved = [...saved, entry].slice(-SAVED_LIMIT);
      savedTurns.set(item.turnId, entry);
      const stored = persist(deps.storage, saved);
      const slot = slots().indexOf(entry) + 1;
      const where = slot > 0 ? "Saved to F" + slot : "Saved · no free F-key (shipped replays use all " + SLOT_COUNT + ")";
      setNote(where + (stored ? "" : " · this session only") + " · " + entry.display, NOTE_MS);
      return slot > 0 ? slot : null;
    },

    exportJson: () => JSON.stringify(saved, null, 2),
    saved: () => saved,
    slots,
    isPlaying: () => run !== null,
    getNote: () => note,
    subscribeNote(listener) {
      noteListeners.add(listener);
      return () => {
        noteListeners.delete(listener);
      };
    },
    notify: (text) => setNote(text, NOTE_MS),
  };
}

// ── App instance ─────────────────────────────────────────────────────────────

function browserStorage(): ReplayStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch (err) {
    // Some privacy modes throw on access; replays then last for the session only.
    console.warn("[replay] localStorage unavailable; saves last until the page reloads", err);
    return null;
  }
}

export const replayer: Replayer = createReplayer({
  store,
  abortLiveTurn: abortTurn,
  newSessionIfBusy: () => {
    if (store.getState().thread.length > 0) store.newSession();
  },
  shipped: BUILTIN_REPLAYS,
  storage: browserStorage(),
});

export function playReplay(slot: number): void {
  replayer.play(slot);
}

export function cancelReplay(): void {
  replayer.cancel();
}

export function saveLastTurn(): void {
  replayer.save();
}

export function exportReplays(): string {
  return replayer.exportJson();
}

/** Shift+E and the dev strip: the saved turns to the console, and to the clipboard when the browser allows it. */
export async function copyReplaysJson(): Promise<void> {
  const json = replayer.exportJson();
  const n = replayer.saved().length;
  console.info("[replay] " + n + " saved turns (shipped replays not included). Paste into src/client/replays.json:\n" + json);
  try {
    await navigator.clipboard.writeText(json);
    replayer.notify("Copied " + n + " replays JSON · also in the console");
  } catch (err) {
    console.warn("[replay] clipboard write failed; copy the JSON from the console", err);
    replayer.notify("Logged " + n + " replays JSON to the console");
  }
}

export function useReplayNote(): string | null {
  return useSyncExternalStore(replayer.subscribeNote, replayer.getNote, replayer.getNote);
}
