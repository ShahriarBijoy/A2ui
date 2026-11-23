import { describe, expect, test } from "bun:test";
import type { A2uiMessage } from "@shared/a2ui";
import type { TurnEvent } from "@shared/protocol";
import type { AgentItem } from "@/state";
import { DINNER_STEP_2 } from "@/a2ui/fixtures";
import { createStore } from "./store";

const CAT = "https://example.test/catalog/brick-box/v1";
const utter = (text: string) => ({ input: { type: "utterance" as const, text }, display: text, via: "voice" as const });
const a2ui = (msg: A2uiMessage, origin: "llm" | "data" | "knob" = "llm"): TurnEvent => ({ type: "a2ui", msg, origin });
const agentOf = (s: ReturnType<typeof createStore>, turnId: string) =>
  s.getState().thread.find((i): i is AgentItem => i.kind === "agent" && i.turnId === turnId);

const usage: TurnEvent = {
  type: "usage",
  model: "claude-haiku-5-5",
  input_tokens: 1200,
  output_tokens: 300,
  first_ui_ms: 900,
  compose_ms: 1800,
  skipped_lines: 0,
};

describe("beginTurn", () => {
  test("adds the user line and a pending agent item synchronously", () => {
    const s = createStore();
    let notified = 0;
    s.subscribe(() => notified++);
    const turnId = s.beginTurn(utter("dinner nearby"));
    const st = s.getState();
    expect(notified).toBe(1);
    expect(st.thread.map((i) => i.kind)).toEqual(["user", "agent"]);
    expect(st.thread[0]).toMatchObject({ kind: "user", text: "dinner nearby", via: "voice", turnId });
    expect(agentOf(s, turnId)).toMatchObject({ status: "pending", mode: "a2ui", replay: false, retry: utter("dinner nearby") });
    expect(st.activeTurnId).toBe(turnId);
    expect(st.totals.turns).toBe(1);
    expect(st.recordings[turnId]).toMatchObject({ display: "dinner nearby", via: "voice", events: [] });
  });
  test("initial settings", () => {
    const st = createStore().getState();
    expect(st).toMatchObject({ mode: "a2ui", decision: true, handsFree: false, newestSurfaceId: null });
  });
});

describe("applyTurnEvent", () => {
  test("a2ui builds the surface, wire log, pool, first-UI time; done finishes", () => {
    const s = createStore();
    const turnId = s.beginTurn(utter("table for four"));
    for (const msg of DINNER_STEP_2.messages) s.applyTurnEvent(turnId, a2ui(msg));
    s.applyTurnEvent(turnId, { type: "caption", text: "Table at Placeholder Bistro" });
    let st = s.getState();
    const agent = agentOf(s, turnId);
    expect(agent?.status).toBe("streaming");
    expect(agent?.surfaceId).toBe("s2");
    expect(agent?.caption).toBe("Table at Placeholder Bistro");
    expect(agent?.metrics.llmCalled).toBe(true);
    expect(typeof agent?.metrics.clientFirstUiMs).toBe("number");
    expect(st.newestSurfaceId).toBe("s2");
    expect(st.pool.used).toEqual(["Card", "Column", "Text", "ChoicePicker", "Stepper", "Button"]);
    expect(st.pool.counts.Text).toBe(2);
    const summaries = st.wire.map((w) => w.summary);
    expect(summaries).toHaveLength(4);
    expect(summaries[0]).toBe("createSurface s2");
    expect(summaries[1]).toStartWith('updateDataModel s2 / = {"booking":{"place":"Placeholder Bistro"');
    expect(summaries[1]).toEndWith("…");
    expect(summaries.slice(2)).toEqual(["updateComponents s2 · 2 components", "updateComponents s2 · 5 components"]);
    expect(st.wire.every((w) => w.dir === "down" && w.origin === "llm" && w.turnId === turnId)).toBe(true);
    s.applyTurnEvent(turnId, { type: "done" });
    st = s.getState();
    expect(agentOf(s, turnId)?.status).toBe("done");
    expect(st.activeTurnId).toBeNull();
    expect(st.recordings[turnId].events.map((e) => e.ev.type)).toEqual(["a2ui", "a2ui", "a2ui", "a2ui", "caption", "done"]);
    expect(st.recordings[turnId].events.every((e) => e.t >= 0)).toBe(true);
  });

  test("route patch counts an avoided LLM call and marks the updated surface", () => {
    const s = createStore();
    const t1 = s.beginTurn(utter("table for four"));
    for (const msg of DINNER_STEP_2.messages) s.applyTurnEvent(t1, a2ui(msg));
    s.applyTurnEvent(t1, { type: "done" });
    const t2 = s.beginTurn(utter("we're six"));
    s.applyTurnEvent(t2, { type: "route", kind: "edit", decision: "patch", ms: 160, engine: "jev-1.14.0", reason: "", patches: 1 });
    s.applyTurnEvent(t2, a2ui({ version: "1.0", updateDataModel: { surfaceId: "s2", path: "/booking/guests", value: 6 } }, "knob"));
    s.applyTurnEvent(t2, { type: "done" });
    const st = s.getState();
    const agent = agentOf(s, t2);
    expect(st.totals.llmAvoided).toBe(1);
    expect(agent?.metrics.route?.decision).toBe("patch");
    expect(agent?.metrics.llmCalled).toBe(false);
    expect(agent?.updatedSurfaceId).toBe("s2");
    expect(agent?.surfaceId).toBeUndefined();
    expect(st.surfaces.s2.data).toMatchObject({ booking: { guests: 6 } });
    // An edit in a later turn leaves a flash stamp; the initial fill in the creating turn did not.
    expect(Object.keys(st.surfaces.s2.changed)).toEqual(["/booking/guests"]);
    expect(st.wire.at(-1)?.summary).toBe("updateDataModel s2 /booking/guests = 6");
    expect(st.wire.at(-1)?.origin).toBe("knob");
    expect(st.pool.used).toEqual([]);
  });

  test("usage adds to the totals", () => {
    const s = createStore();
    const t = s.beginTurn(utter("x"));
    s.applyTurnEvent(t, usage);
    s.applyTurnEvent(t, usage);
    const st = s.getState();
    expect(st.totals).toMatchObject({ llmCalls: 2, inputTokens: 2400, outputTokens: 600 });
    expect(agentOf(s, t)?.metrics.usage).toMatchObject({ model: "claude-haiku-5-5", compose_ms: 1800 });
    expect(agentOf(s, t)?.metrics.usage).not.toHaveProperty("type");
  });

  test("error sets the status; done keeps it; failTurn does not overwrite it", () => {
    const s = createStore();
    const t = s.beginTurn(utter("x"));
    s.applyTurnEvent(t, { type: "error", message: "compose timed out" });
    expect(agentOf(s, t)).toMatchObject({ status: "error", error: "compose timed out" });
    s.failTurn(t, "Connection closed");
    s.applyTurnEvent(t, { type: "done" });
    expect(agentOf(s, t)).toMatchObject({ status: "error", error: "compose timed out" });
    expect(s.getState().activeTurnId).toBeNull();
  });

  test("failTurn on a running turn shows the message; events for unknown turns are ignored", () => {
    const s = createStore();
    const t = s.beginTurn(utter("x"));
    s.failTurn(t, "Timed out");
    expect(agentOf(s, t)).toMatchObject({ status: "error", error: "Timed out" });
    const before = s.getState();
    s.applyTurnEvent("t-unknown", { type: "done" });
    expect(s.getState()).toBe(before);
  });

  test("refusals are counted and answered with error entries", () => {
    const s = createStore();
    const t = s.beginTurn(utter("login"));
    s.applyTurnEvent(t, a2ui({ version: "1.0", createSurface: { surfaceId: "s9", catalogId: CAT } }));
    s.applyTurnEvent(t, a2ui({ version: "1.0", updateComponents: { surfaceId: "s9", components: [{ id: "root", component: "LoginForm" }] } }));
    const st = s.getState();
    expect(st.totals.refusals).toBe(1);
    expect(agentOf(s, t)?.metrics.refused).toBe(1);
    const err = st.wire.at(-1);
    expect(err).toMatchObject({ dir: "up", kind: "error", origin: "renderer", surfaceId: "s9" });
    expect(err?.json).toMatchObject({ version: "1.0", error: { code: "VALIDATION_FAILED", path: "/components/0/component" } });
  });
});

describe("local writes and actions", () => {
  test("setData writes without a wire entry or flash stamp; emitAction resolves context and logs", () => {
    const s = createStore();
    s.applyA2ui(DINNER_STEP_2.messages[0], "llm");
    s.applyA2ui(DINNER_STEP_2.messages[1], "llm");
    const wireBefore = s.getState().wire.length;
    s.setData("s2", "/booking/guests", 5);
    expect(s.getState().wire.length).toBe(wireBefore);
    expect(s.getState().surfaces.s2.changed).toEqual({});
    const action = s.emitAction(
      "s2",
      "confirm",
      { event: { name: "confirm_booking", context: { guests: { "@path": "/booking/guests" }, time: { "@path": "/booking/time" } } } },
      "/",
    );
    expect(action).toMatchObject({ name: "confirm_booking", surfaceId: "s2", sourceComponentId: "confirm", context: { guests: 5, time: ["19:00"] } });
    expect(Number.isNaN(Date.parse(action.timestamp))).toBe(false);
    expect(s.getState().wire.at(-1)).toMatchObject({ dir: "up", kind: "action", origin: "renderer" });
  });
  test("predicted bricks only add; clearThread keeps settings and totals", () => {
    const s = createStore();
    s.addPredicted(["Stepper", "Text"]);
    s.addPredicted(["Text", "SeatMap"]);
    expect(s.getState().pool.predicted).toEqual(["Stepper", "Text", "SeatMap"]);
    s.setMode("html");
    const t = s.beginTurn(utter("x"));
    s.applyTurnEvent(t, usage);
    s.clearThread();
    const st = s.getState();
    expect(st.thread).toEqual([]);
    expect(st.pool).toEqual({ predicted: [], used: [], counts: {} });
    expect(st.mode).toBe("html");
    expect(st.totals.llmCalls).toBe(1);
    expect(st.recordings[t]).toBeDefined();
  });
});

describe("buildTurnRequest", () => {
  test("derives the thread (user, tap, agent), snapshots the newest surface, picks a fresh surface id", () => {
    const s = createStore();
    const t1 = s.beginTurn(utter("table for four"));
    for (const msg of DINNER_STEP_2.messages) s.applyTurnEvent(t1, a2ui(msg));
    s.applyTurnEvent(t1, { type: "caption", text: "Table at Placeholder Bistro" });
    s.applyTurnEvent(t1, { type: "done" });

    const t2 = s.beginTurn(utter("we're six"));
    s.applyTurnEvent(t2, { type: "route", kind: "edit", decision: "patch", ms: 150, engine: "jev", reason: "", patches: 1 });
    s.applyTurnEvent(t2, { type: "done" });

    const action = s.emitAction("s2", "confirm", { event: { name: "confirm_booking", context: { guests: { "@path": "/booking/guests" } } } }, "/");
    s.beginTurn({ input: { type: "action", action }, display: "confirm_booking · 4", via: "tap" });

    const req = s.buildTurnRequest({ type: "utterance", text: "next" });
    expect(req.thread).toEqual([
      { role: "user", text: "table for four" },
      { role: "agent", text: "Table at Placeholder Bistro" },
      { role: "user", text: "we're six" },
      { role: "agent", text: "changed values in place" },
      { role: "tap", text: 'tapped confirm_booking {"guests":4}' },
      { role: "agent", text: "no answer" },
    ]);
    expect(req.mode).toBe("a2ui");
    expect(req.decision).toBe(true);
    expect(req.surface?.id).toBe("s2");
    expect(req.surface?.components).toContainEqual({ id: "guests", component: "Stepper" });
    expect(req.surface?.data).toMatchObject({ booking: { guests: 4 } });
    expect(Array.isArray(req.surface?.knobs)).toBe(true);
    // s2 is taken by the fixture, so the counter skips it.
    expect(req.nextSurfaceId).toBe("s1");
    expect(s.buildTurnRequest({ type: "utterance", text: "again" }).nextSurfaceId).toBe("s3");
  });
  test("keeps only the last 6 entries and has no surface when none exists", () => {
    const s = createStore();
    for (let i = 0; i < 5; i++) {
      const t = s.beginTurn(utter("line " + i));
      s.applyTurnEvent(t, { type: "done" });
    }
    const req = s.buildTurnRequest({ type: "utterance", text: "x" });
    expect(req.thread).toHaveLength(6);
    expect(req.thread[0]).toEqual({ role: "user", text: "line 2" });
    expect(req.surface).toBeNull();
  });
});
