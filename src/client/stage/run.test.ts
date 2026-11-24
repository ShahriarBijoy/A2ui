import { describe, expect, test } from "bun:test";
import type { AgentItem, ThreadItem, TurnMetrics, TurnRecording, WireEntry } from "@/state";
import {
  bigNumbers,
  componentRows,
  doneTime,
  firstContent,
  fitBoxes,
  runHistory,
  runStatus,
  runSteps,
  runSubtitle,
  sameBoxes,
  streamHeader,
  tokensPerSecond,
  turnMessages,
  writtenIds,
  type TimedMessage,
} from "./run";

const V = "1.0";

function agent(turnId: string, metrics: Partial<TurnMetrics> = {}, extra: Partial<AgentItem> = {}): AgentItem {
  return {
    kind: "agent",
    id: "a-" + turnId,
    turnId,
    mode: "a2ui",
    status: "done",
    metrics: { startedAt: 1000, llmCalled: true, refused: 0, ...metrics },
    replay: false,
    retry: { input: { type: "utterance", text: "q " + turnId }, display: "q " + turnId, via: "voice" },
    ...extra,
  };
}

const USAGE = {
  model: "claude-sonnet-5-5",
  input_tokens: 5000,
  output_tokens: 600,
  first_ui_ms: 850,
  compose_ms: 4000,
  skipped_lines: 0,
};
const ROUTE = { kind: "new" as const, decision: "compose" as const, ms: 228, engine: "jev-1.14.0", reason: "new task", patches: 0 };

let seq = 0;
function wire(turnId: string, t: number, json: unknown, origin: WireEntry["origin"] = "llm", dir: WireEntry["dir"] = "down"): WireEntry {
  return { seq: ++seq, t, dir, kind: dir === "up" ? "error" : "updateComponents", origin, surfaceId: "s1", turnId, summary: "", json };
}
const comps = (...components: object[]) => ({ version: V, updateComponents: { surfaceId: "s1", components } });
const data = (path: string, value: unknown) => ({ version: V, updateDataModel: { surfaceId: "s1", path, value } });
const rec = (doneAt: number | null): TurnRecording => ({
  display: "x",
  via: "voice",
  mode: "a2ui",
  events: doneAt === null ? [{ t: 10, ev: { type: "caption", text: "c" } }] : [{ t: 10, ev: { type: "caption", text: "c" } }, { t: doneAt, ev: { type: "done" } }],
});

describe("turnMessages", () => {
  test("the turn's messages and refusals in order, timed from the turn's start; other turns and actions left out", () => {
    const log = [
      wire("t1", 1500, comps({ id: "root", component: "Card", child: "m" })),
      wire("t2", 1600, comps({ id: "x", component: "Text", text: "x" })),
      wire("t1", 1700, { version: V, error: { path: "/components/0", message: "m" } }, "renderer", "up"),
      { ...wire("t1", 1800, { version: V, action: { name: "a" } }, "renderer", "up"), kind: "action" as const },
      wire("t1", 3200, data("/r", []), "data"),
    ];
    const out = turnMessages(log, "t1", 1000);
    expect(out.map((m) => [m.origin, m.atMs])).toEqual([
      ["llm", 500],
      ["renderer", 700],
      ["data", 2200],
    ]);
  });

  test("no start time: no arrival times", () => {
    expect(turnMessages([wire("t1", 1500, comps())], "t1", null)[0].atMs).toBeNull();
  });
});

describe("doneTime", () => {
  test("the done event's time, or null when the turn was not recorded or has not ended", () => {
    expect(doneTime(rec(4300))).toBe(4300);
    expect(doneTime(rec(null))).toBeNull();
    expect(doneTime(undefined)).toBeNull();
  });
});

describe("runSteps", () => {
  test("route, first UI, each fetch and done from measured values", () => {
    const item = agent("t1", {
      route: ROUTE,
      clientFirstUiMs: 910,
      fetches: [
        { source: "search", query: "flights", ok: true, records: 3, ms: 2700 },
        { source: "search", query: "hotels", ok: false, records: 0, ms: 400, error: "timeout" },
      ],
    });
    expect(runSteps(item, 4300).map((s) => [s.label, s.value, s.detail ?? "", s.state])).toEqual([
      ["Route", "228 ms", "compose", "done"],
      ["First UI", "0.9 s", "", "done"],
      ["search", "2.7 s", "3 records", "done"],
      ["search", "0.4 s", "failed", "failed"],
      ["Done", "4.3 s", "", "done"],
    ]);
  });

  test("a finished turn shows – for what was never measured", () => {
    expect(runSteps(agent("t1"), null).map((s) => [s.label, s.value, s.state])).toEqual([
      ["Route", "–", "skipped"],
      ["First UI", "–", "skipped"],
      ["Data", "–", "skipped"],
      ["Done", "–", "skipped"],
    ]);
  });

  test("a running turn shows … for what is still to come", () => {
    const steps = runSteps(agent("t1", { route: ROUTE }, { status: "streaming" }), null);
    expect(steps.map((s) => s.value)).toEqual(["228 ms", "…", "–", "…"]);
  });
});

describe("bigNumbers", () => {
  const msgs: TimedMessage[] = [
    { msg: comps({ id: "root", component: "Card", child: "m" }, { id: "m", component: "Column", children: [] }), origin: "llm", atMs: 900 },
    { msg: comps({ id: "title", component: "Text", text: "## Hi" }), origin: "llm", atMs: 1200 },
    { msg: data("/results", [{ id: "a" }]), origin: "data", atMs: 3100 },
  ];

  test("first screen, first content (first data when there is some) and done, all on the client clock", () => {
    const n = bigNumbers(agent("t1", { clientFirstUiMs: 900 }), msgs, 4300);
    expect(n.map((x) => [x.label, x.value, x.caption])).toEqual([
      ["First screen", "0.9 s", "frame on screen"],
      ["First content", "3.1 s", "first data"],
      ["Done", "4.3 s", "turn finished"],
    ]);
  });

  test("without data, first content is the first component that is not a container", () => {
    expect(firstContent(msgs.slice(0, 2))).toEqual({ ms: 1200, basis: "component" });
    expect(firstContent(msgs.slice(0, 1))).toBeNull();
  });

  test("missing values read –", () => {
    expect(bigNumbers(agent("t1"), [], null).map((x) => x.value)).toEqual(["–", "–", "–"]);
  });
});

describe("labels", () => {
  test("tokens per second only when usage measured both numbers", () => {
    expect(tokensPerSecond(agent("t1", { usage: USAGE }))).toBe(150);
    expect(tokensPerSecond(agent("t1"))).toBeNull();
    expect(tokensPerSecond(agent("t1", { usage: { ...USAGE, compose_ms: 0 } }))).toBeNull();
  });

  test("the stream header names the writer only once it is known", () => {
    const msgs = [
      { msg: comps(), origin: "llm" as const },
      { msg: data("/a", 1), origin: "knob" as const },
      { msg: {}, origin: "renderer" as const },
    ];
    expect(streamHeader(agent("t1", { usage: USAGE }), msgs)).toBe("claude-sonnet-5-5 wrote · A2UI JSON · 2 lines");
    expect(streamHeader(agent("t1", { route: { ...ROUTE, decision: "patch", patches: 1 } }), msgs.slice(1, 2))).toBe(
      "Decision model wrote · A2UI JSON · 1 line",
    );
    expect(streamHeader(agent("t1", {}, { status: "streaming" }), [])).toBe("A2UI JSON · 0 lines");
  });

  test("subtitle and status", () => {
    expect(runSubtitle(agent("t1", { usage: USAGE }))).toBe("Composed by claude-sonnet-5-5");
    expect(runSubtitle(agent("t1", { route: { ...ROUTE, decision: "patch" } }))).toBe("Patched by the decision model");
    expect(runSubtitle(agent("t1", {}, { status: "pending" }))).toBe("Composing…");
    expect(runStatus(agent("t1", {}, { status: "pending" }))).toBe("streaming");
    expect(runStatus(agent("t1", {}, { status: "error" }))).toBe("error");
  });
});

describe("runHistory", () => {
  test("one row per turn: prompt, mode, model, characters written and time taken", () => {
    const thread: ThreadItem[] = [
      { kind: "user", id: "u1", turnId: "t1", text: "Dinner nearby", via: "voice" },
      agent("t1", { usage: USAGE }),
      { kind: "user", id: "u2", turnId: "t2", text: "We're six", via: "voice" },
      agent("t2", { route: { ...ROUTE, decision: "patch", patches: 1 } }),
      { kind: "user", id: "u3", turnId: "t3", text: "Show widgets", via: "text" },
      agent("t3", { usage: USAGE }, { mode: "widgets", widget: { name: "RestaurantWidget", props: { places: [] } } }),
    ];
    const m1 = comps({ id: "root", component: "Card", child: "m" });
    const m2 = data("/booking/guests", 6);
    const log = [wire("t1", 1500, m1), wire("t2", 1500, m2, "knob")];
    const rows = runHistory(thread, log, { t1: rec(4300), t2: rec(240) });
    expect(rows.map((r) => [r.prompt, r.mode, r.model, r.written, r.tookMs])).toEqual([
      ["Dinner nearby", "A2UI", "claude-sonnet-5-5", JSON.stringify(m1).length + 1, 4300],
      ["We're six", "A2UI · patch", "jev-1.14.0", JSON.stringify(m2).length + 1, 240],
      ["Show widgets", "Widgets", "claude-sonnet-5-5", JSON.stringify({ places: [] }).length, null],
    ]);
  });
});

describe("wireframe", () => {
  test("fitBoxes scales the surface down to the panel, never up, keeping proportions", () => {
    const f = fitBoxes([{ id: "root", x: 0, y: 0, w: 640, h: 400 }, { id: "d", x: 20, y: 200, w: 600, h: 1 }], { w: 640, h: 400 }, 320, 300);
    expect(f.scale).toBe(0.5);
    expect([f.width, f.height]).toEqual([320, 200]);
    expect(f.rects[1]).toEqual({ id: "d", x: 10, y: 100, w: 300, h: 1 });
    expect(fitBoxes([], { w: 100, h: 50 }, 320, 300).scale).toBe(1);
    expect(fitBoxes([], { w: 0, h: 50 }, 320, 300).rects).toEqual([]);
  });

  test("a tall surface is limited by the height", () => {
    expect(fitBoxes([], { w: 600, h: 1200 }, 300, 200).scale).toBeCloseTo(1 / 6, 6);
  });

  test("component rows: written ids in order, their type, status and first drawn box", () => {
    const msgs = [
      { msg: comps({ id: "root", component: "Card", child: "list" }, { id: "list", component: "List", children: { path: "/r", componentId: "item" } }), origin: "llm" as const },
      { msg: comps({ id: "item", component: "OptionCard", title: "x" }, { id: "bad", component: "Video" }, { id: "root", component: "Card", child: "list" }), origin: "llm" as const },
    ];
    const ids = writtenIds(msgs);
    expect(ids).toEqual(["root", "list", "item", "bad"]);
    const components = {
      root: { status: "ok" as const, def: { component: "Card" } },
      list: { status: "ok" as const, def: { component: "List" } },
      item: { status: "ok" as const, def: { component: "OptionCard" } },
      bad: { status: "refused" as const, component: "Video" },
    };
    const boxes = [
      { id: "root", x: 0, y: 0, w: 600.4, h: 300 },
      { id: "item", x: 20, y: 60.6, w: 560, h: 80 },
      { id: "item", x: 20, y: 150, w: 560, h: 80 },
    ];
    expect(componentRows(ids, components, boxes).map((r) => [r.id, r.type, r.status, r.box && [r.box.x, r.box.y, r.box.w, r.box.h], r.count])).toEqual([
      ["root", "Card", "ok", [0, 0, 600, 300], 1],
      ["list", "List", "ok", null, 0],
      ["item", "OptionCard", "ok", [20, 61, 560, 80], 2],
      ["bad", "Video", "refused", null, 0],
    ]);
  });

  test("sameBoxes compares to the pixel", () => {
    expect(sameBoxes([{ id: "a", x: 1.2, y: 0, w: 10, h: 10 }], [{ id: "a", x: 1.4, y: 0, w: 10, h: 10 }])).toBe(true);
    expect(sameBoxes([{ id: "a", x: 1, y: 0, w: 10, h: 10 }], [{ id: "a", x: 3, y: 0, w: 10, h: 10 }])).toBe(false);
    expect(sameBoxes([], [{ id: "a", x: 1, y: 0, w: 10, h: 10 }])).toBe(false);
  });
});
