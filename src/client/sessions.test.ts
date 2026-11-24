import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { AgentItem, SurfaceState, ThreadItem, UserItem } from "@/state";
import {
  loadSessions,
  MAX_WIRE_SAVED,
  sanitizeSnapshot,
  saveSessions,
  sessionIcon,
  sessionTitle,
  SESSIONS_KEY,
  type SessionSnapshot,
} from "./sessions";

const user = (text: string, via: UserItem["via"] = "voice", n = 1): UserItem => ({
  kind: "user",
  id: "u" + n,
  turnId: "t" + n,
  text,
  via,
});
const agent = (over: Partial<AgentItem> = {}, n = 1): AgentItem => ({
  kind: "agent",
  id: "a" + n,
  turnId: "t" + n,
  mode: "a2ui",
  status: "done",
  metrics: { startedAt: 100, llmCalled: true, refused: 0 },
  replay: false,
  retry: { input: { type: "utterance", text: "hi" }, display: "hi", via: "voice" },
  ...over,
});
const surface = (id: string, comps: Record<string, Record<string, unknown>>): SurfaceState => ({
  id,
  catalogId: "cat",
  turnId: "t1",
  components: Object.fromEntries(
    Object.entries(comps).map(([cid, def]) => [
      cid,
      { status: "ok" as const, def: { id: cid, ...def } as never, firstSeen: 5 },
    ]),
  ),
  data: {},
  changed: {},
  hasDemoData: false,
});
const snap = (id: string, thread: ThreadItem[] = [user("dinner"), agent()], over: Partial<SessionSnapshot> = {}): SessionSnapshot => ({
  meta: { id, title: "x", icon: null, createdAt: 1, updatedAt: 2, turns: 1 },
  thread,
  surfaces: {},
  newestSurfaceId: null,
  wire: [],
  pool: { predicted: [], used: [], counts: {} },
  ...over,
});

let warn: ReturnType<typeof spyOn>;
let error: ReturnType<typeof spyOn>;
beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
});

describe("sessionTitle", () => {
  test("uses the first utterance, at most 48 characters", () => {
    const t = sessionTitle([user("I want dinner after this event, pick a place nearby and book it")]);
    expect(t).toBe("I want dinner after this event, pick a place ne…");
    expect(t.length).toBe(48);
    expect(sessionTitle([])).toBe("New session");
  });
  test("a short line stays whole; a spoken line beats an earlier tap", () => {
    expect(sessionTitle([user("Split the bill")])).toBe("Split the bill");
    expect(sessionTitle([user("pick_restaurant · r1", "tap", 1), agent(), user("We're six", "voice", 2)])).toBe("We're six");
  });
});

describe("sessionIcon", () => {
  test("returns the first Icon brick's name, else null", () => {
    const s1 = surface("s1", { root: { component: "Text", text: "hi" } });
    const s2 = surface("s2", { root: { component: "Column", children: ["i"] }, i: { component: "Icon", name: "plane" } });
    expect(sessionIcon({ s1, s2 })).toBe("plane");
    expect(sessionIcon({})).toBeNull();
    expect(sessionIcon({ s1 })).toBeNull();
  });
  test("an Icon with a non-literal or unknown name is skipped", () => {
    const s1 = surface("s1", {
      a: { component: "Icon", name: { path: "/icon" } },
      b: { component: "Icon", name: "rocket-ship" },
      c: { component: "Icon", name: "utensils" },
    });
    expect(sessionIcon({ s1 })).toBe("utensils");
  });
});

describe("loadSessions", () => {
  const storage = (text: string | null) => ({ getItem: (k: string) => (k === SESSIONS_KEY ? text : null) });
  test("skips corrupt JSON and invalid entries", () => {
    expect(loadSessions(storage("{nope"))).toEqual([]);
    expect(loadSessions(storage(null))).toEqual([]);
    expect(loadSessions(storage('{"a":1}'))).toEqual([]);
    const out = loadSessions(storage(JSON.stringify([snap("a"), {}])));
    expect(out).toHaveLength(1);
    expect(out[0].meta.id).toBe("a");
  });
  test("storage that throws on read gives no sessions", () => {
    const bad = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(loadSessions(bad)).toEqual([]);
  });
  test("most recent first", () => {
    const older = snap("old");
    const newer = snap("new", undefined, { meta: { ...snap("new").meta, updatedAt: 50 } });
    expect(loadSessions(storage(JSON.stringify([older, newer]))).map((s) => s.meta.id)).toEqual(["new", "old"]);
  });
});

describe("sanitizeSnapshot", () => {
  test("pending turns are restored as stopped", () => {
    const raw = JSON.parse(
      JSON.stringify(snap("a", [user("x"), agent({ status: "pending" }), user("y", "voice", 2), agent({ status: "streaming" }, 2)])),
    );
    const out = sanitizeSnapshot(raw);
    expect(out).not.toBeNull();
    const statuses = out!.thread.filter((i): i is AgentItem => i.kind === "agent").map((a) => a.status);
    expect(statuses).toEqual(["done", "done"]);
  });
  test("flash stamps are dropped and the title and turns come from the thread", () => {
    const s = surface("s1", { root: { component: "Text", text: "hi" } });
    const raw = JSON.parse(JSON.stringify(snap("a", undefined, { surfaces: { s1: { ...s, changed: { "/x": 99_999 } } }, newestSurfaceId: "s1" })));
    const out = sanitizeSnapshot(raw)!;
    expect(out.surfaces.s1.changed).toEqual({});
    // The old page's clock: a later change on this page must count as newer, so the patch flash still shows.
    expect(out.surfaces.s1.components.root.firstSeen).toBe(0);
    expect(out.newestSurfaceId).toBe("s1");
    expect(out.meta.title).toBe("dinner");
    expect(out.meta.turns).toBe(1);
  });
  test("a brick this build does not know becomes a refusal", () => {
    const s = surface("s1", { root: { component: "Sparkline", values: [1, 2] } });
    const out = sanitizeSnapshot(JSON.parse(JSON.stringify(snap("a", undefined, { surfaces: { s1: s } }))))!;
    expect(out.surfaces.s1.components.root).toMatchObject({ status: "refused", component: "Sparkline" });
  });
  test("an invalid thread item rejects the session; a newest id without a surface becomes null", () => {
    expect(sanitizeSnapshot({ ...snap("a"), thread: [{ kind: "agent", id: "a1" }] })).toBeNull();
    expect(sanitizeSnapshot({ ...snap("a"), meta: { id: "" } })).toBeNull();
    expect(sanitizeSnapshot({ ...snap("a"), newestSurfaceId: "gone" })?.newestSurfaceId).toBeNull();
  });
});

describe("saveSessions", () => {
  test("returns false when storage throws", () => {
    const bad = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(saveSessions(bad, [snap("a")])).toBe(false);
  });
  test("writes the newest wire entries only, and drops the oldest sessions when full", () => {
    const map = new Map<string, string>();
    const wire = Array.from({ length: MAX_WIRE_SAVED + 5 }, (_, i) => ({
      seq: i + 1,
      t: i,
      dir: "down" as const,
      kind: "createSurface" as const,
      origin: "llm" as const,
      surfaceId: "s1",
      summary: "x",
      json: null,
    }));
    let calls = 0;
    const tight = {
      setItem: (k: string, v: string) => {
        calls++;
        // Only one session fits.
        if (JSON.parse(v).length > 1) throw new Error("QuotaExceededError");
        map.set(k, v);
      },
    };
    expect(saveSessions(tight, [snap("new", undefined, { wire }), snap("old")])).toBe(true);
    expect(calls).toBe(2);
    const saved = JSON.parse(map.get(SESSIONS_KEY)!);
    expect(saved.map((s: SessionSnapshot) => s.meta.id)).toEqual(["new"]);
    expect(saved[0].wire).toHaveLength(MAX_WIRE_SAVED);
    expect(saved[0].wire[0].seq).toBe(6);
  });
});
