import { describe, expect, test } from "bun:test";
import type { AgentItem, AppState, ThreadItem } from "@/state";
import { createTurnSelection, newestAgentTurnId, selectedTurnId } from "./selection";

const agent = (turnId: string): AgentItem => ({
  kind: "agent",
  id: "a-" + turnId,
  turnId,
  mode: "a2ui",
  status: "done",
  metrics: { startedAt: 0, llmCalled: false, refused: 0 },
  replay: false,
  retry: { input: { type: "utterance", text: turnId }, display: turnId, via: "voice" },
});
const user = (turnId: string): ThreadItem => ({ kind: "user", id: "u-" + turnId, turnId, text: turnId, via: "voice" });

function fakeStore(thread: ThreadItem[]) {
  let state = { thread } as AppState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    setThread(next: ThreadItem[]) {
      state = { ...state, thread: next };
      for (const l of [...listeners]) l();
    },
  };
}

describe("turn selection", () => {
  test("follows the newest turn; a pinned turn wins while it exists", () => {
    const thread = [user("t1"), agent("t1"), user("t2"), agent("t2")];
    expect(newestAgentTurnId(thread)).toBe("t2");
    expect(selectedTurnId(thread, null)).toBe("t2");
    expect(selectedTurnId(thread, "t1")).toBe("t1");
    expect(selectedTurnId(thread, "gone")).toBe("t2");
    expect(selectedTurnId([], null)).toBeNull();
  });

  test("a new turn unpins; pinning the newest follows it", () => {
    const st = fakeStore([user("t1"), agent("t1"), user("t2"), agent("t2")]);
    const sel = createTurnSelection(st);
    let calls = 0;
    sel.subscribe(() => calls++);
    sel.pin("t1");
    expect(sel.getPinned()).toBe("t1");
    st.setThread([...st.getState().thread]);
    expect(sel.getPinned()).toBe("t1");
    st.setThread([...st.getState().thread, user("t3"), agent("t3")]);
    expect(sel.getPinned()).toBeNull();
    sel.pin("t3");
    expect(sel.getPinned()).toBeNull();
    sel.pin("t2");
    st.setThread([]);
    expect(sel.getPinned()).toBeNull();
    expect(calls).toBe(4);
  });
});
