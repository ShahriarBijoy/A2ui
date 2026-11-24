import { describe, expect, test } from "bun:test";
import {
  buildTimeline,
  chipParts,
  formatMs,
  formatPriceLevel,
  formatSeconds,
  formatTokens,
  openTurnIds,
  pickInteractiveSurface,
  tailText,
  wireCounts,
  wireDetail,
} from "./format";
import type { AgentItem, SurfaceState, ThreadItem, UserItem, WireEntry } from "./state";

const agent = (over: Partial<AgentItem> = {}, metrics: Partial<AgentItem["metrics"]> = {}): AgentItem => ({
  kind: "agent",
  id: "a1",
  turnId: "t1",
  mode: "a2ui",
  status: "done",
  metrics: { startedAt: 100, llmCalled: false, refused: 0, ...metrics },
  replay: false,
  retry: { input: { type: "utterance", text: "hi" }, display: "hi", via: "text" },
  ...over,
});

const usage = {
  model: "claude-haiku-5-5",
  input_tokens: 4100,
  output_tokens: 312,
  first_ui_ms: 600,
  compose_ms: 1800,
  skipped_lines: 0,
};
const route = (decision: "patch" | "compose", patches = 0) => ({
  kind: decision === "patch" ? ("edit" as const) : ("new" as const),
  decision,
  ms: 162,
  engine: "jev-1.14.0",
  reason: decision === "patch" ? "" : "kind new",
  patches,
});
const texts = (item: AgentItem) => chipParts(item).map((p) => p.text);

describe("number formatting", () => {
  test("formatMs picks the natural unit", () => {
    expect(formatMs(162.4)).toBe("162 ms");
    expect(formatMs(999)).toBe("999 ms");
    expect(formatMs(1800)).toBe("1.8 s");
    expect(formatMs(12_400)).toBe("12 s");
    expect(formatMs(Number.NaN)).toBe("–");
    expect(formatMs(-1)).toBe("–");
  });
  test("formatSeconds keeps tiny values in ms", () => {
    expect(formatSeconds(600)).toBe("0.6 s");
    expect(formatSeconds(1840)).toBe("1.8 s");
    expect(formatSeconds(42)).toBe("42 ms");
    expect(formatSeconds(15_000)).toBe("15 s");
  });
  test("formatTokens compacts", () => {
    expect(formatTokens(0)).toBe("0");
    expect(formatTokens(312)).toBe("312");
    expect(formatTokens(2100)).toBe("2.1k");
    expect(formatTokens(2000)).toBe("2k");
    expect(formatTokens(12_345)).toBe("12k");
    expect(formatTokens(1_250_000)).toBe("1.3M");
  });
  test("price level", () => {
    expect(formatPriceLevel(2)).toBe("€€");
    expect(formatPriceLevel(0)).toBe("€");
    expect(formatPriceLevel(9)).toBe("€€€€");
  });
  test("tailText keeps the newest words", () => {
    expect(tailText("short", 20)).toBe("short");
    const t = tailText("one two three four five six seven", 15);
    expect(t.startsWith("…")).toBe(true);
    expect(t.endsWith("six seven")).toBe(true);
    expect(t.length).toBeLessThanOrEqual(16);
  });
});

describe("chipParts: measured values only", () => {
  test("full compose turn", () => {
    const item = agent({}, { route: route("compose"), usage, clientFirstUiMs: 420, llmCalled: true });
    expect(texts(item)).toEqual([
      "route 162 ms",
      "compose 1.8 s",
      "first UI 0.6 s",
      "seen 0.4 s",
      "312 tok",
      "claude-haiku-5-5",
      "jev-1.14.0",
    ]);
  });
  test("patch turn: compose is a dash, the decision model is highlighted", () => {
    const parts = chipParts(agent({}, { route: route("patch", 2), clientFirstUiMs: 190 }));
    expect(parts.map((p) => p.text)).toEqual([
      "route 162 ms",
      "compose –",
      "decision model · 2 values",
      "seen 0.2 s",
      "jev-1.14.0",
    ]);
    expect(parts.find((p) => p.key === "compose")?.tone).toBe("strong");
    expect(parts.find((p) => p.key === "patch")?.tone).toBe("highlight");
  });
  test("one value reads singular", () => {
    expect(texts(agent({}, { route: route("patch", 1) }))).toContain("decision model · 1 value");
  });
  test("decision off: no route, no invented numbers", () => {
    const item = agent({}, { usage: { ...usage, first_ui_ms: null }, llmCalled: true });
    expect(texts(item)).toEqual(["route –", "compose 1.8 s", "312 tok", "claude-haiku-5-5"]);
  });
  test("in flight: ellipses, never zeros", () => {
    expect(texts(agent({ status: "pending" }))).toEqual(["route …", "compose …"]);
    expect(texts(agent({ status: "streaming" }, { route: route("compose"), llmCalled: true }))).toEqual([
      "route 162 ms",
      "compose …",
      "jev-1.14.0",
    ]);
  });
  test("cache reads and refusals show only when present", () => {
    const item = agent({}, { usage: { ...usage, cache_read_tokens: 2100 }, llmCalled: true, refused: 2 });
    expect(texts(item)).toContain("cached 2.1k");
    expect(texts(item)).toContain("2 refused");
    expect(texts(agent({}, { usage: { ...usage, cache_read_tokens: 0 }, llmCalled: true }))).not.toContain("cached 0");
  });
  test("compose – is only emphasised on patch turns", () => {
    const aborted = chipParts(agent({ status: "done" }));
    expect(aborted.find((p) => p.key === "compose")).toEqual({ key: "compose", text: "compose –", tone: "muted" });
    const failed = chipParts(agent({ status: "error" }));
    expect(failed.find((p) => p.key === "compose")?.tone).toBe("muted");
  });
  test("failed turn after an LLM call shows no compose number", () => {
    expect(texts(agent({ status: "error" }, { llmCalled: true }))).toEqual(["route –"]);
  });
});

describe("chipParts: live data lines", () => {
  const search = {
    source: "search" as const,
    query: "dinner near the venue",
    ok: true,
    records: 5,
    ms: 6240,
    searches: 1,
    input_tokens: 15_200,
    output_tokens: 410,
  };
  test("no fetches: nothing extra", () => {
    const item = agent({}, { route: route("compose"), usage, llmCalled: true });
    expect(chipParts(item).some((p) => p.key.startsWith("fetch"))).toBe(false);
    expect(texts(item)).toContain("312 tok");
  });
  test("a search adds its time and count after compose, and its output tokens to tok", () => {
    const item = agent({}, { route: route("compose"), usage, llmCalled: true, fetches: [search] });
    expect(texts(item)).toEqual([
      "route 162 ms",
      "compose 1.8 s",
      "search 6.2 s · 5 results",
      "first UI 0.6 s",
      "722 tok",
      "claude-haiku-5-5",
      "jev-1.14.0",
    ]);
    const tok = chipParts(item).find((p) => p.key === "tok");
    expect(tok?.title).toBe("output tokens: compose 312 + data 410");
    expect(chipParts(item).find((p) => p.key === "fetch0")?.title).toBe("dinner near the venue · 1 web search");
  });
  test("one segment per data line, never a summed or longest time", () => {
    const flights = { source: "search" as const, query: "flights from Bremen to New York", ok: true, records: 1, ms: 3400 };
    const item = agent({}, { usage, llmCalled: true, fetches: [search, flights] });
    const t = texts(item);
    expect(t).toContain("search 6.2 s · 5 results");
    expect(t).toContain("search 3.4 s · 1 result");
    expect(t).toContain("722 tok");
  });
  test("a failed search reads 'search failed' in the failed tone, never '0 results'", () => {
    const failed = { source: "search" as const, query: "concerts", ok: false, records: 0, ms: 12_000, error: "timeout" };
    const parts = chipParts(agent({}, { usage, llmCalled: true, fetches: [failed] }));
    const p = parts.find((x) => x.key === "fetch0");
    expect(p).toEqual({ key: "fetch0", text: "search failed", tone: "failed", title: "concerts · 12 s · timeout" });
    expect(parts.map((x) => x.text).join(" ")).not.toContain("0 results");
  });
  test("a successful search with no matches says so", () => {
    const none = { ...search, records: 0, searches: undefined, output_tokens: undefined };
    const item = agent({}, { usage, llmCalled: true, fetches: [none] });
    expect(texts(item)).toContain("search 6.2 s · 0 results");
    expect(texts(item)).toContain("312 tok");
  });
  test("no usage: fetch tokens are not shown on their own", () => {
    const item = agent({ status: "streaming" }, { llmCalled: true, fetches: [search] });
    expect(texts(item)).toEqual(["route …", "compose …", "search 6.2 s · 5 results"]);
  });
});

const surface = (id: string, firstSeen: number[]): SurfaceState => ({
  id,
  catalogId: "",
  turnId: null,
  components: Object.fromEntries(
    firstSeen.map((t, i) => [
      `c${i}`,
      { status: "refused" as const, id: `c${i}`, component: "X", reason: "", firstSeen: t },
    ]),
  ),
  data: {},
  changed: {},
  hasDemoData: false,
});
const user = (turnId: string): UserItem => ({ kind: "user", id: `u-${turnId}`, turnId, text: "x", via: "text" });

describe("buildTimeline", () => {
  test("orphan surfaces (fixtures) appear in time order between turns", () => {
    const a1 = agent({ id: "a1", turnId: "t1", surfaceId: "s1" }, { startedAt: 100 });
    const a2 = agent({ id: "a2", turnId: "t2" }, { startedAt: 300 });
    const thread: ThreadItem[] = [user("t1"), a1, user("t2"), a2];
    const surfaces = { s1: surface("s1", [110]), fx: surface("fx", [200, 250]), late: surface("late", [400]) };
    const tl = buildTimeline(thread, surfaces);
    expect(tl.map((e) => (e.kind === "surface" ? e.surfaceId : e.item.id))).toEqual([
      "u-t1",
      "a1",
      "fx",
      "u-t2",
      "a2",
      "late",
    ]);
  });
  test("surfaces without components go last; claimed surfaces never duplicate", () => {
    const a1 = agent({ surfaceId: "s1" });
    const tl = buildTimeline([user("t1"), a1], { s1: surface("s1", [1]), empty: surface("empty", []) });
    expect(tl.filter((e) => e.kind === "surface").map((e) => (e.kind === "surface" ? e.surfaceId : ""))).toEqual([
      "empty",
    ]);
  });
  test("pickInteractiveSurface prefers the store's newest, else the last surface shown", () => {
    const surfaces = { s1: surface("s1", [1]), fx: surface("fx", [2]) };
    const tl = buildTimeline([user("t1"), agent({ surfaceId: "s1" }, { startedAt: 0 })], surfaces);
    expect(pickInteractiveSurface(tl, surfaces, "s1")).toBe("s1");
    expect(pickInteractiveSurface(tl, surfaces, null)).toBe("fx");
    expect(pickInteractiveSurface(tl, surfaces, "gone")).toBe("fx");
    expect(pickInteractiveSurface([], {}, null)).toBeNull();
  });
});

describe("wireDetail", () => {
  test("drops the kind and surface the row already shows", () => {
    expect(wireDetail({ kind: "updateDataModel", surfaceId: "s2", summary: "updateDataModel s2 /booking/guests = 6" })).toBe(
      "/booking/guests = 6",
    );
    expect(wireDetail({ kind: "updateComponents", surfaceId: "s2", summary: "updateComponents s2 · 5 components" })).toBe(
      "5 components",
    );
    expect(wireDetail({ kind: "createSurface", surfaceId: "s2", summary: "createSurface s2" })).toBe("");
    expect(wireDetail({ kind: "error", surfaceId: "s9", summary: "error /components/2/component · Unknown" })).toBe(
      "/components/2/component · Unknown",
    );
    expect(wireDetail({ kind: "action", surfaceId: "s2", summary: "action confirm · {}" })).toBe("confirm · {}");
    expect(wireDetail({ kind: "error", surfaceId: "", summary: "rejected · bad envelope" })).toBe("rejected · bad envelope");
  });
  test("does not cut a longer surface id that shares a prefix", () => {
    expect(wireDetail({ kind: "createSurface", surfaceId: "s1", summary: "createSurface s12" })).toBe("s12");
  });
});

describe("wireCounts", () => {
  const w = (dir: WireEntry["dir"], kind: WireEntry["kind"]): WireEntry => ({
    seq: 0,
    t: 0,
    dir,
    kind,
    origin: "llm",
    surfaceId: "s1",
    summary: "",
    json: null,
  });
  test("counts messages, actions and refusals", () => {
    expect(
      wireCounts([w("down", "createSurface"), w("down", "updateComponents"), w("up", "action"), w("up", "error")]),
    ).toEqual({ messages: 2, actions: 1, refused: 1 });
  });
});

describe("openTurnIds", () => {
  const turn = (n: number, over: Partial<AgentItem> = {}): ThreadItem[] => [
    user("t" + n),
    agent({ id: "a" + n, turnId: "t" + n, ...over }, { startedAt: n * 100 }),
  ];
  const ids = (s: Set<string>) => [...s].sort();

  test("newest turn and the interactive surface's turn stay open", () => {
    const thread = [...turn(1, { surfaceId: "s1" }), ...turn(2, { surfaceId: "s2" }), ...turn(3, { text: "no widget" })];
    const surfaces = { s1: surface("s1", [110]), s2: surface("s2", [210]) };
    const tl = buildTimeline(thread, surfaces);
    expect(ids(openTurnIds(tl, "s2"))).toEqual(["t2", "t3"]);
  });
  test("after a patch turn, the patched screen's turn stays open", () => {
    const thread = [...turn(1, { surfaceId: "s1" }), ...turn(2, { surfaceId: "s2" }), ...turn(3, { updatedSurfaceId: "s2" })];
    const tl = buildTimeline(thread, { s1: surface("s1", [110]), s2: surface("s2", [210]) });
    expect(ids(openTurnIds(tl, "s2"))).toEqual(["t2", "t3"]);
  });
  test("a single turn is open; an empty timeline has none", () => {
    expect(ids(openTurnIds(buildTimeline(turn(1, { surfaceId: "s1" }), { s1: surface("s1", [110]) }), "s1"))).toEqual(["t1"]);
    expect(openTurnIds([], null).size).toBe(0);
  });
  test("while the newest turn streams, the screen it replaces stays open; it folds when the turn is done", () => {
    const surfaces = { s1: surface("s1", [110]), s2: surface("s2", [210]) };
    const streaming = [...turn(1, { surfaceId: "s1" }), ...turn(2, { surfaceId: "s2", status: "streaming" })];
    expect(ids(openTurnIds(buildTimeline(streaming, surfaces), "s2"))).toEqual(["t1", "t2"]);
    const done = [...turn(1, { surfaceId: "s1" }), ...turn(2, { surfaceId: "s2" })];
    expect(ids(openTurnIds(buildTimeline(done, surfaces), "s2"))).toEqual(["t2"]);
  });
});
