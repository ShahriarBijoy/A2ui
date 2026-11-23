import { describe, expect, test } from "bun:test";
import type { A2uiMessage, JsonValue } from "@shared/a2ui";
import type { TurnEvent } from "@shared/protocol";
import { createStore, surfaceStreaming } from "@/store";
import { templateState, templateView } from "./template";

const CAT = "https://example.test/catalog/brick-box/v1";
const LIST = { path: "/places", componentId: "place" };
const a2ui = (msg: A2uiMessage, origin: "llm" | "data" = "llm"): TurnEvent => ({ type: "a2ui", msg, origin });
const UI_FIRST: A2uiMessage[] = [
  { version: "1.0", createSurface: { surfaceId: "s1", catalogId: CAT } },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s1",
      components: [
        { id: "root", component: "List", children: LIST },
        { id: "place", component: "OptionCard", title: { "@path": "name" }, subtitle: { "@path": "kind" } },
      ],
    },
  },
];
const PLACES: JsonValue = [
  { id: "p1", name: "One" },
  { id: "p2", name: "Two" },
];

describe("templateState (pure)", () => {
  test("undefined → pending, [] or a non-list → empty, array → items with stable keys and scopes", () => {
    expect(templateState(LIST, {}, "/")).toEqual({ kind: "pending" });
    expect(templateState(LIST, { places: [] }, "/")).toEqual({ kind: "empty" });
    expect(templateState(LIST, { places: { not: "a list" } }, "/")).toEqual({ kind: "empty" });
    expect(templateState(LIST, { places: PLACES }, "/")).toEqual({
      kind: "items",
      items: [
        { key: "id:p1", scope: "/places/0" },
        { key: "id:p2", scope: "/places/1" },
      ],
    });
  });
  test("relative template paths resolve in the parent scope; duplicate or missing ids fall back to the index", () => {
    const data = { places: [{ id: "p1", tags: ["a", "b"] }] };
    expect(templateState({ path: "tags", componentId: "tag" }, data, "/places/0")).toEqual({
      kind: "items",
      items: [
        { key: "i:0", scope: "/places/0/tags/0" },
        { key: "i:1", scope: "/places/0/tags/1" },
      ],
    });
    const dup: JsonValue = { xs: [{ id: "a" }, { id: "a" }, { name: "no id" }] };
    const state = templateState({ path: "/xs", componentId: "x" }, dup, "/");
    expect(state.kind === "items" && state.items.map((i) => i.key)).toEqual(["id:a", "i:1", "i:2"]);
  });
  test("templateView: pending is a skeleton only while streaming", () => {
    expect(templateView(LIST, {}, "/", true)).toEqual({ kind: "skeleton" });
    expect(templateView(LIST, {}, "/", false)).toEqual({ kind: "empty" });
    expect(templateView(LIST, { places: [] }, "/", true)).toEqual({ kind: "empty" });
  });
});

describe("live data after the UI (store level)", () => {
  test("streaming → skeletons; the data line arrives → items; done keeps the items", () => {
    const s = createStore();
    const t = s.beginTurn({ input: { type: "utterance", text: "dinner" }, display: "dinner", via: "voice" });
    for (const msg of UI_FIRST) s.applyTurnEvent(t, a2ui(msg));
    let st = s.getState();
    expect(surfaceStreaming(st, "s1")).toBe(true);
    expect(templateView(LIST, st.surfaces.s1.data, "/", surfaceStreaming(st, "s1"))).toEqual({ kind: "skeleton" });

    s.applyTurnEvent(t, a2ui({ version: "1.0", updateDataModel: { surfaceId: "s1", path: "/places", value: PLACES } }, "data"));
    st = s.getState();
    const view = templateView(LIST, st.surfaces.s1.data, "/", surfaceStreaming(st, "s1"));
    expect(view.kind).toBe("items");
    s.applyTurnEvent(t, { type: "done" });
    st = s.getState();
    expect(surfaceStreaming(st, "s1")).toBe(false);
    expect(templateView(LIST, st.surfaces.s1.data, "/", false).kind).toBe("items");
  });
  test("done (or error) without data → the calm empty state, not an endless skeleton", () => {
    for (const end of [{ type: "done" }, { type: "error", message: "search failed" }] as TurnEvent[]) {
      const s = createStore();
      const t = s.beginTurn({ input: { type: "utterance", text: "dinner" }, display: "dinner", via: "voice" });
      for (const msg of UI_FIRST) s.applyTurnEvent(t, a2ui(msg));
      s.applyTurnEvent(t, end);
      const st = s.getState();
      expect(surfaceStreaming(st, "s1")).toBe(false);
      expect(templateView(LIST, st.surfaces.s1.data, "/", surfaceStreaming(st, "s1"))).toEqual({ kind: "empty" });
    }
  });
  test("an empty result list → empty state even while streaming", () => {
    const s = createStore();
    const t = s.beginTurn({ input: { type: "utterance", text: "dinner" }, display: "dinner", via: "voice" });
    for (const msg of UI_FIRST) s.applyTurnEvent(t, a2ui(msg));
    s.applyTurnEvent(t, a2ui({ version: "1.0", updateDataModel: { surfaceId: "s1", path: "/places", value: [] } }, "data"));
    const st = s.getState();
    expect(templateView(LIST, st.surfaces.s1.data, "/", surfaceStreaming(st, "s1"))).toEqual({ kind: "empty" });
  });
  test("a later turn updating the surface makes it streaming again; an unrelated pending turn does not", () => {
    const s = createStore();
    const t1 = s.beginTurn({ input: { type: "utterance", text: "dinner" }, display: "dinner", via: "voice" });
    for (const msg of UI_FIRST) s.applyTurnEvent(t1, a2ui(msg));
    s.applyTurnEvent(t1, { type: "done" });
    const t2 = s.beginTurn({ input: { type: "utterance", text: "cheaper" }, display: "cheaper", via: "voice" });
    expect(surfaceStreaming(s.getState(), "s1")).toBe(false);
    s.applyTurnEvent(t2, a2ui({ version: "1.0", updateDataModel: { surfaceId: "s1", path: "/note", value: "x" } }));
    expect(surfaceStreaming(s.getState(), "s1")).toBe(true);
    s.applyTurnEvent(t2, { type: "done" });
    expect(surfaceStreaming(s.getState(), "s1")).toBe(false);
  });
});
