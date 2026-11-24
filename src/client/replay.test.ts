import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { A2uiMessage } from "@shared/a2ui";
import type { Mode, TurnEvent, TurnInput } from "@shared/protocol";
import type { AgentItem, StoreApi } from "@/state";
import { DINNER_STEP_2, FIXTURE_CATALOG_ID } from "@/a2ui/fixtures";
import {
  BUILTIN_REPLAYS,
  createReplayer,
  parseRecordings,
  playableEvents,
  SAVED_LIMIT,
  slotList,
  STORAGE_KEY,
  type Recording,
  type ReplayStorage,
} from "./replay";
import { createStore } from "./store";

// ── Fakes ────────────────────────────────────────────────────────────────────

/** Timers on a fake clock: advance() fires due timers in time order, then in the order they were set. */
function fakeClock() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number): unknown => {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (h: unknown) => {
      timers.delete(h as number);
    },
    pending: () => timers.size,
    advance(ms: number) {
      const end = now + ms;
      for (;;) {
        let next: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of timers) {
          if (entry[1].at > end) continue;
          if (!next || entry[1].at < next[1].at || (entry[1].at === next[1].at && entry[0] < next[0])) next = entry;
        }
        if (!next) break;
        timers.delete(next[0]);
        now = next[1].at;
        next[1].fn();
      }
      now = end;
    },
  };
}

function memoryStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(STORAGE_KEY, initial);
  const storage: ReplayStorage & { map: Map<string, string> } = {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
  return storage;
}

type Env = {
  store: StoreApi;
  clock: ReturnType<typeof fakeClock>;
  storage: ReturnType<typeof memoryStorage>;
  deferred: (() => void)[];
  aborts: number;
  replayer: ReturnType<typeof createReplayer>;
  flushDeferred(): void;
};

function setup(opts: { shipped?: Recording[]; storage?: ReturnType<typeof memoryStorage>; store?: StoreApi } = {}): Env {
  const env = {
    store: opts.store ?? createStore(),
    clock: fakeClock(),
    storage: opts.storage ?? memoryStorage(),
    deferred: [] as (() => void)[],
    aborts: 0,
  } as Env;
  env.replayer = createReplayer({
    store: env.store,
    abortLiveTurn: () => {
      env.aborts++;
    },
    shipped: opts.shipped ?? [],
    storage: env.storage,
    now: env.clock.now,
    setTimer: env.clock.setTimer,
    clearTimer: env.clock.clearTimer,
    defer: (fn) => env.deferred.push(fn),
  });
  env.flushDeferred = () => {
    for (const fn of env.deferred.splice(0)) fn();
  };
  return env;
}

const a2ui = (msg: A2uiMessage, origin: "llm" | "data" | "knob" = "llm"): TurnEvent => ({ type: "a2ui", msg, origin });
const utter = (text: string): TurnInput => ({ type: "utterance", text });
const rec = (display: string, events: [number, TurnEvent][], mode: Mode = "a2ui"): Recording => ({
  display,
  via: "text",
  mode,
  input: utter(display),
  events: events.map(([t, ev]) => ({ t, ev })),
});

const agents = (s: StoreApi) => s.getState().thread.filter((i): i is AgentItem => i.kind === "agent");
const lastAgent = (s: StoreApi) => agents(s).at(-1);
/** Types of the events that reached the store for a turn, in arrival order. */
const arrived = (s: StoreApi, turnId: string) => (s.getState().recordings[turnId]?.events ?? []).map((e) => e.ev.type);

const create = (id: string): A2uiMessage => ({ version: "1.0", createSurface: { surfaceId: id, catalogId: FIXTURE_CATALOG_ID } });
const root = (id: string): A2uiMessage => ({
  version: "1.0",
  updateComponents: { surfaceId: id, components: [{ id: "root", component: "Text", text: "hello" }] },
});

const DINNER: Recording = rec("dinner nearby", [
  [150, { type: "route", kind: "new", decision: "compose", ms: 150, engine: "jev-1.14.0", reason: "new", patches: 0 }],
  [600, a2ui(create("s1"))],
  [900, a2ui(root("s1"))],
  [1200, { type: "caption", text: "A table nearby." }],
  [1300, { type: "done" }],
]);

let warn: ReturnType<typeof spyOn>;
let error: ReturnType<typeof spyOn>;
let info: ReturnType<typeof spyOn>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
  info = spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
  info.mockRestore();
});

// ── Scheduling ───────────────────────────────────────────────────────────────

describe("play", () => {
  test("events arrive in order at their recorded times, as a replay item", () => {
    const env = setup({ shipped: [DINNER] });
    expect(env.replayer.play(1)).toBe(true);
    const item = lastAgent(env.store)!;
    expect(item).toMatchObject({ replay: true, status: "pending", retry: { input: utter("dinner nearby"), via: "text" } });
    expect(env.store.getState().replaying).toBe(true);
    expect(env.store.getState().activeTurnId).toBe(item.turnId);

    env.clock.advance(149);
    expect(arrived(env.store, item.turnId)).toEqual([]);
    env.clock.advance(1);
    expect(arrived(env.store, item.turnId)).toEqual(["route"]);
    env.clock.advance(450);
    expect(arrived(env.store, item.turnId)).toEqual(["route", "a2ui"]);
    expect(env.store.getState().surfaces.s1).toBeDefined();
    env.clock.advance(300);
    expect(env.store.getState().surfaces.s1.components.root).toBeDefined();
    env.clock.advance(300);
    expect(lastAgent(env.store)!.caption).toBe("A table nearby.");
    expect(env.store.getState().replaying).toBe(true);
    env.clock.advance(100);
    expect(arrived(env.store, item.turnId)).toEqual(["route", "a2ui", "a2ui", "caption", "done"]);
  });

  test("events with the same time keep their recorded order", () => {
    const env = setup({
      shipped: [rec("same t", [[100, a2ui(create("s1"))], [100, a2ui(root("s1"))], [100, { type: "caption", text: "x" }], [100, { type: "done" }]])],
    });
    env.replayer.play(1);
    const turnId = lastAgent(env.store)!.turnId;
    env.clock.advance(100);
    expect(arrived(env.store, turnId)).toEqual(["a2ui", "a2ui", "caption", "done"]);
    expect(env.store.getState().surfaces.s1.components.root).toBeDefined();
  });

  test("replaying turns off after the last event, with no timer left behind", () => {
    const env = setup({ shipped: [DINNER] });
    env.replayer.play(1);
    expect(env.replayer.isPlaying()).toBe(true);
    env.clock.advance(1300);
    expect(env.store.getState().replaying).toBe(false);
    expect(env.store.getState().activeTurnId).toBeNull();
    expect(lastAgent(env.store)!.status).toBe("done");
    expect(env.replayer.isPlaying()).toBe(false);
    expect(env.replayer.getNote()).toBeNull();
    expect(env.clock.pending()).toBe(0);
  });

  test("a recording without a done (the stream failed) still ends", () => {
    const env = setup({ shipped: [rec("cut short", [[100, a2ui(create("s1"))], [400, a2ui(root("s1"))]])] });
    env.replayer.play(1);
    env.clock.advance(400);
    expect(arrived(env.store, lastAgent(env.store)!.turnId)).toEqual(["a2ui", "a2ui", "done"]);
    expect(env.store.getState().replaying).toBe(false);
  });

  test("aborts the live turn first and switches to the recording's mode", () => {
    const env = setup({ shipped: [rec("pink page", [[50, { type: "html", delta: "<p>hi</p>" }], [60, { type: "done" }]], "html")] });
    env.replayer.play(1);
    expect(env.aborts).toBe(1);
    expect(env.store.getState().mode).toBe("html");
    expect(lastAgent(env.store)!.mode).toBe("html");
    env.clock.advance(60);
    expect(lastAgent(env.store)!.html).toBe("<p>hi</p>");
  });

  test("an empty slot starts nothing and says so", () => {
    const env = setup({ shipped: [DINNER] });
    expect(env.replayer.play(4)).toBe(false);
    expect(env.store.getState().thread).toHaveLength(0);
    expect(env.replayer.getNote()).toBe("F4 is empty");
  });

  test("the note reads Replaying F1 while it plays", () => {
    const env = setup({ shipped: [DINNER] });
    env.replayer.play(1);
    expect(env.replayer.getNote()).toBe("Replaying F1 · dinner nearby");
  });
});

describe("cancel", () => {
  test("Esc: cancel then clearThread stops every timer and resets replaying", () => {
    const env = setup({ shipped: [DINNER] });
    env.replayer.play(1);
    const turnId = lastAgent(env.store)!.turnId;
    env.clock.advance(700);
    expect(arrived(env.store, turnId)).toEqual(["route", "a2ui"]);
    env.replayer.cancel();
    // Ended where it stood, quietly, before the wave pictures it.
    expect(lastAgent(env.store)!.status).toBe("done");
    expect(env.store.getState().replaying).toBe(false);
    env.store.clearThread();
    expect(env.clock.pending()).toBe(0);
    env.clock.advance(5000);
    expect(env.store.getState().thread).toHaveLength(0);
    expect(env.store.getState().surfaces).toEqual({});
    expect(env.replayer.isPlaying()).toBe(false);
    expect(env.replayer.getNote()).toBeNull();
  });

  test("a clear from elsewhere (dev runner Reset) also stops the timers", () => {
    const env = setup({ shipped: [DINNER] });
    env.replayer.play(1);
    env.clock.advance(200);
    env.store.clearThread();
    expect(env.replayer.isPlaying()).toBe(false);
    expect(env.clock.pending()).toBe(0);
    env.flushDeferred();
    env.clock.advance(5000);
    expect(env.store.getState().thread).toHaveLength(0);
    expect(env.store.getState().replaying).toBe(false);
  });

  test("a new live turn stops the replay; the replay item ends as done and the live turn is untouched", () => {
    const env = setup({ shipped: [DINNER] });
    env.replayer.play(1);
    const replayId = lastAgent(env.store)!.turnId;
    env.clock.advance(700);
    const liveId = env.store.beginTurn({ input: utter("a flight"), display: "a flight", via: "voice" });
    expect(env.replayer.isPlaying()).toBe(false);
    expect(env.clock.pending()).toBe(0);
    env.flushDeferred();
    const [replayItem, liveItem] = agents(env.store);
    expect(replayItem).toMatchObject({ turnId: replayId, status: "done", replay: true });
    expect(liveItem).toMatchObject({ turnId: liveId, status: "pending", replay: false });
    expect(env.store.getState().replaying).toBe(false);
    expect(env.store.getState().activeTurnId).toBe(liveId);
    env.clock.advance(5000);
    expect(arrived(env.store, replayId)).toEqual(["route", "a2ui", "done"]);
    expect(arrived(env.store, liveId)).toEqual([]);
  });

  test("an F-key during a replay completes it at once, then plays the next onto its surface", () => {
    const tap = rec("tap", [[300, a2ui({ version: "1.0", updateDataModel: { surfaceId: "s1", path: "/picked", value: "Bistro" } })], [350, { type: "done" }]]);
    const env = setup({ shipped: [DINNER, tap] });
    env.replayer.play(1);
    const first = lastAgent(env.store)!.turnId;
    env.clock.advance(200);
    env.replayer.play(2);
    expect(arrived(env.store, first)).toEqual(["route", "a2ui", "a2ui", "caption", "done"]);
    expect(agents(env.store)[0].status).toBe("done");
    expect(env.store.getState().replaying).toBe(true);
    env.clock.advance(350);
    expect(env.store.getState().surfaces.s1.data).toEqual({ picked: "Bistro" });
    expect(env.store.getState().replaying).toBe(false);
    expect(env.clock.pending()).toBe(0);
  });
});

// ── Saving and loading ───────────────────────────────────────────────────────

/** A live turn as turns.ts drives it: buildTurnRequest, beginTurn, events, done. Returns the surface id it used. */
function liveTurn(s: StoreApi, input: TurnInput, display: string, via: "voice" | "text" | "tap", events: (sid: string) => TurnEvent[]): string {
  const req = s.buildTurnRequest(input);
  const turnId = s.beginTurn({ input, display, via });
  for (const ev of events(req.nextSurfaceId)) s.applyTurnEvent(turnId, ev);
  return req.nextSurfaceId;
}

describe("save", () => {
  test("saves the newest finished live turn with its input; F-keys follow the order of saving", () => {
    const env = setup();
    liveTurn(env.store, utter("first"), "first", "text", (sid) => [a2ui(create(sid)), a2ui(root(sid)), { type: "done" }]);
    expect(env.replayer.save()).toBe(1);
    expect(env.replayer.getNote()).toBe("Saved to F1 · first");
    liveTurn(env.store, utter("second"), "second", "voice", () => [{ type: "caption", text: "ok" }, { type: "done" }]);
    expect(env.replayer.save()).toBe(2);
    const stored = JSON.parse(env.storage.map.get(STORAGE_KEY)!) as Recording[];
    expect(stored.map((r) => r.display)).toEqual(["first", "second"]);
    expect(stored[1]).toMatchObject({ via: "voice", mode: "a2ui", input: utter("second") });
    expect(stored[1].events.map((e) => e.ev.type)).toEqual(["caption", "done"]);
    expect(stored[1].events.every((e) => Number.isInteger(e.t))).toBe(true);
  });

  test("skips a turn still streaming and replay items", () => {
    const env = setup({ shipped: [DINNER] });
    liveTurn(env.store, utter("finished"), "finished", "text", () => [{ type: "caption", text: "ok" }, { type: "done" }]);
    env.replayer.play(1);
    env.clock.advance(5000);
    env.store.beginTurn({ input: utter("running"), display: "running", via: "text" });
    // F1 is shipped, so the save goes to F2.
    expect(env.replayer.save()).toBe(2);
    expect(env.replayer.saved().map((r) => r.display)).toEqual(["finished"]);
  });

  test("nothing finished: no save, a note instead", () => {
    const env = setup();
    env.store.beginTurn({ input: utter("running"), display: "running", via: "text" });
    expect(env.replayer.save()).toBeNull();
    expect(env.replayer.saved()).toHaveLength(0);
    expect(env.replayer.getNote()).toBe("Nothing to save: finish a turn first");
  });

  test("a second Shift+R on the same turn does not take a second key", () => {
    const env = setup();
    liveTurn(env.store, utter("once"), "once", "text", () => [{ type: "done" }]);
    expect(env.replayer.save()).toBe(1);
    expect(env.replayer.save()).toBe(1);
    expect(env.replayer.saved()).toHaveLength(1);
    expect(env.replayer.getNote()).toBe("Already saved to F1 · once");
  });

  test("keeps the newest 12; the newest six take the free keys in order of saving", () => {
    const env = setup();
    for (let i = 1; i <= 14; i++) {
      liveTurn(env.store, utter("turn " + i), "turn " + i, "text", () => [{ type: "done" }]);
      env.replayer.save();
    }
    expect(env.replayer.saved()).toHaveLength(SAVED_LIMIT);
    expect(env.replayer.saved()[0].display).toBe("turn 3");
    expect(env.replayer.slots().map((r) => r.display)).toEqual(["turn 9", "turn 10", "turn 11", "turn 12", "turn 13", "turn 14"]);
    expect(env.replayer.getNote()).toBe("Saved to F6 · turn 14");
  });

  test("saves load back in a new page, in order", () => {
    const storage = memoryStorage();
    const first = setup({ storage });
    for (const name of ["a", "b"]) {
      liveTurn(first.store, utter(name), name, "text", () => [{ type: "done" }]);
      first.replayer.save();
    }
    const second = setup({ storage });
    expect(second.replayer.slots().map((r) => r.display)).toEqual(["a", "b"]);
  });

  test("storage full: the oldest saves are dropped until the rest fits", () => {
    const storage = memoryStorage();
    storage.setItem = (k, v) => {
      if ((JSON.parse(v) as unknown[]).length > 2) throw new Error("QuotaExceededError");
      storage.map.set(k, v);
    };
    const env = setup({ storage });
    for (const name of ["a", "b", "c"]) {
      liveTurn(env.store, utter(name), name, "text", () => [{ type: "done" }]);
      env.replayer.save();
    }
    expect((JSON.parse(storage.map.get(STORAGE_KEY)!) as Recording[]).map((r) => r.display)).toEqual(["b", "c"]);
    expect(env.replayer.saved()).toHaveLength(3);
    expect(warn).toHaveBeenCalled();
  });

  test("storage that refuses everything: the save lasts for the session and says so", () => {
    const env = setup({
      storage: Object.assign(memoryStorage(), {
        setItem: () => {
          throw new Error("SecurityError");
        },
      }),
    });
    liveTurn(env.store, utter("only here"), "only here", "text", () => [{ type: "done" }]);
    expect(env.replayer.save()).toBe(1);
    expect(env.replayer.getNote()).toBe("Saved to F1 · this session only · only here");
    expect(error).toHaveBeenCalled();
  });

  test("broken storage loads as no saves, logged", () => {
    expect(setup({ storage: memoryStorage("{not json") }).replayer.saved()).toEqual([]);
    expect(error).toHaveBeenCalled();
    const mixed = JSON.stringify([{ display: "ok", via: "text", mode: "a2ui", input: utter("ok"), events: [] }, { display: 3 }]);
    expect(setup({ storage: memoryStorage(mixed) }).replayer.saved().map((r) => r.display)).toEqual(["ok"]);
    expect(warn).toHaveBeenCalled();
  });

  test("exportJson round-trips through the validator used for replays.json", () => {
    const env = setup();
    liveTurn(env.store, utter("dinner"), "dinner", "text", (sid) => [a2ui(create(sid)), a2ui(root(sid)), { type: "done" }]);
    env.replayer.save();
    const back = parseRecordings(JSON.parse(env.replayer.exportJson()) as unknown, "export");
    expect(back).toEqual([...env.replayer.saved()]);
  });
});

describe("slots and recordings", () => {
  test("shipped replays keep F1 onward; saves fill the keys after them, newest win", () => {
    const shipped = [rec("s-1", []), rec("s-2", [])];
    const saved = ["a", "b", "c", "d", "e"].map((n) => rec(n, []));
    expect(slotList(shipped, saved).map((r) => r.display)).toEqual(["s-1", "s-2", "b", "c", "d", "e"]);
    expect(slotList([], saved.slice(0, 2)).map((r) => r.display)).toEqual(["a", "b"]);
    const six = Array.from({ length: 7 }, (_, i) => rec("s" + i, []));
    expect(slotList(six, saved).map((r) => r.display)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
  });

  test("with six shipped replays a save has no key and says so", () => {
    const env = setup({ shipped: Array.from({ length: 6 }, (_, i) => rec("s" + i, [])) });
    liveTurn(env.store, utter("extra"), "extra", "text", () => [{ type: "done" }]);
    expect(env.replayer.save()).toBeNull();
    expect(env.replayer.getNote()).toBe("Saved · no free F-key (shipped replays use all 6) · extra");
    expect(env.replayer.saved()).toHaveLength(1);
  });

  test("playableEvents stops at the first done and adds one when missing", () => {
    const e = (t: number, ev: TurnEvent) => ({ t, ev });
    expect(playableEvents([e(1, { type: "done" }), e(2, { type: "caption", text: "late" })]).map((x) => x.ev.type)).toEqual(["done"]);
    expect(playableEvents([e(5, { type: "caption", text: "x" })])).toEqual([e(5, { type: "caption", text: "x" }), e(5, { type: "done" })]);
    expect(playableEvents([])).toEqual([e(0, { type: "done" })]);
  });

  test("parseRecordings keeps times monotonic and falls back to the display as input", () => {
    const [r] = parseRecordings(
      [{ display: "x", via: "tap", mode: "widgets", events: [{ t: 50, ev: { type: "caption", text: "a" } }, { t: 20, ev: { type: "done" } }] }],
      "test",
    );
    expect(r.events.map((e) => e.t)).toEqual([50, 50]);
    expect(r.input).toEqual(utter("x"));
    expect(parseRecordings({}, "test")).toEqual([]);
  });

  test("the shipped set loads from replays.json", () => {
    expect(Array.isArray(BUILTIN_REPLAYS)).toBe(true);
  });

  test("the shipped replays play in order with no validation errors and carry no demo data", () => {
    // Whole-ms times, as a Shift+R save stores them: the fake clock adds float delays, and with captured
    // fractional times a tiny remainder can stop adding to a large clock value (real timers always advance).
    const shipped = BUILTIN_REPLAYS.map((r) => ({ ...r, events: r.events.map((e) => ({ ...e, t: Math.round(e.t) })) }));
    const env = setup({ shipped });
    for (let slot = 1; slot <= Math.min(6, shipped.length); slot++) {
      expect(env.replayer.play(slot)).toBe(true);
      env.clock.advance(60_000);
      expect(env.store.getState().replaying).toBe(false);
    }
    const st = env.store.getState();
    expect(st.wire.filter((w) => w.kind === "error")).toEqual([]);
    expect(Object.values(st.surfaces).some((s) => s.hasDemoData)).toBe(false);
    // Owner rule: no fixed data. Every data line in a shipped recording is a live search.
    const fetches = BUILTIN_REPLAYS.flatMap((r) => r.events.flatMap((e) => (e.ev.type === "fetch" ? [e.ev] : [])));
    expect(fetches.every((f) => f.source === "search")).toBe(true);
    expect(JSON.stringify(BUILTIN_REPLAYS)).not.toMatch(/"demo":\s*true/);
  });
});

// ── A saved sequence after Esc (the stage case) ──────────────────────────────

describe("a saved three-turn sequence", () => {
  const [createMsg, ...rest] = DINNER_STEP_2.messages;

  /** Rehearsal: build, tap Confirm, then a decision-model edit, each saved with Shift+R. */
  function rehearse() {
    const storage = memoryStorage();
    const env = setup({ storage });
    const s = env.store;
    let sid = "";
    // The fixture's surface id is s2; a live composer writes to nextSurfaceId, so rewrite it.
    const onto = (id: string, m: A2uiMessage): A2uiMessage => JSON.parse(JSON.stringify(m).replaceAll('"surfaceId":"s2"', '"surfaceId":"' + id + '"')) as A2uiMessage;
    liveTurn(s, utter("dinner after this event"), "dinner after this event", "voice", (id) => {
      sid = id;
      return [a2ui(onto(id, createMsg)), ...rest.map((m) => a2ui(onto(id, m))), { type: "caption", text: "Table for four." }, { type: "done" }];
    });
    env.replayer.save();
    const action = s.emitAction(sid, "confirm", { event: { name: "confirm_booking", context: { guests: { "@path": "/booking/guests" } } } }, "");
    liveTurn(s, { type: "action", action }, "confirm_booking · 4", "tap", () => [
      a2ui({ version: "1.0", updateDataModel: { surfaceId: sid, path: "/booking/confirmed", value: true } }),
      { type: "caption", text: "Booked." },
      { type: "done" },
    ]);
    env.replayer.save();
    liveTurn(s, utter("we're six, and later"), "we're six, and later", "voice", () => [
      { type: "route", kind: "edit", decision: "patch", ms: 156, engine: "jev-1.14.0", reason: "edit", patches: 2 },
      a2ui({ version: "1.0", updateDataModel: { surfaceId: sid, path: "/booking/time", value: ["20:00"] } }, "knob"),
      a2ui({ version: "1.0", updateDataModel: { surfaceId: sid, path: "/booking/guests", value: 6 } }, "knob"),
      { type: "caption", text: "Six at 20:00." },
      { type: "done" },
    ]);
    env.replayer.save();
    return { env, storage, sid, live: s.getState().surfaces[sid] };
  }

  function playAll(env: Env) {
    for (const slot of [1, 2, 3]) {
      expect(env.replayer.play(slot)).toBe(true);
      env.clock.advance(10_000);
      expect(env.store.getState().replaying).toBe(false);
    }
  }

  test("after Esc on the same page, F1 F2 F3 rebuild the same surface", () => {
    const { env, sid, live } = rehearse();
    env.store.clearThread();
    playAll(env);
    const st = env.store.getState();
    expect(Object.keys(st.surfaces)).toEqual([sid]);
    expect(st.surfaces[sid].data).toEqual(live.data);
    expect(st.surfaces[sid].data).toMatchObject({ booking: { time: ["20:00"], guests: 6, confirmed: true } });
    expect(Object.keys(st.surfaces[sid].components).sort()).toEqual(Object.keys(live.components).sort());
    expect(st.newestSurfaceId).toBe(sid);
    expect(agents(env.store).map((a) => [a.replay, a.status, a.surfaceId ?? a.updatedSurfaceId])).toEqual([
      [true, "done", sid],
      [true, "done", sid],
      [true, "done", sid],
    ]);
    expect(agents(env.store)[2].metrics.route?.decision).toBe("patch");
    expect(st.wire.filter((w) => w.kind === "error")).toEqual([]);
    expect(env.store.buildTurnRequest(utter("next")).nextSurfaceId).not.toBe(sid);
  });

  test("on a fresh page (the stage machine), the saved sequence plays the same way", () => {
    const { storage, sid, live } = rehearse();
    const stage = setup({ storage });
    playAll(stage);
    const st = stage.store.getState();
    expect(st.surfaces[sid].data).toEqual(live.data);
    expect(st.newestSurfaceId).toBe(sid);
    expect(agents(stage.store)[1].retry.input.type).toBe("action");
    expect(agents(stage.store).every((a) => a.replay && a.status === "done")).toBe(true);
    expect(st.wire.filter((w) => w.kind === "error")).toEqual([]);
    // A live turn after the replays must not reuse a replayed id.
    expect(stage.store.buildTurnRequest(utter("next")).nextSurfaceId).not.toBe(sid);
  });
});
