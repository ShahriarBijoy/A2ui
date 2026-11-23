import { describe, expect, test } from "bun:test";
import { createKeyProvider, createVoiceController, type RecordingCallbacks, type VoiceStore } from "./soniox";
import type { Timers } from "./transcript";
import type { Transcript } from "../state";

function fakeClock() {
  let now = 0;
  let id = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      pending.set(id, { at: now + ms, fn });
      return id++;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { timers, advance, now: () => now };
}

function setup(handsFree = false) {
  const clock = fakeClock();
  const state = { handsFree, transcript: { final: "", interim: "", listening: false } as Transcript };
  const turns: string[] = [];
  const log: string[] = [];
  let cb!: RecordingCallbacks;
  const handle = {
    connected: false,
    finalize: () => log.push("finalize"),
    stop: () => log.push("stop"),
    cancel: () => log.push("cancel"),
  };
  const store = {
    getState: () => state,
    setTranscript: (t: Partial<Transcript>) => void (state.transcript = { ...state.transcript, ...t }),
    addPredicted: () => {},
    clearPredicted: () => log.push("clearPredicted"),
    setHandsFree: (on: boolean) => void (state.handsFree = on),
  } as unknown as VoiceStore;
  const ctl = createVoiceController({
    store,
    sendTurn: (o) => void turns.push(o.display),
    start: (_o, c) => {
      cb = c;
      return handle;
    },
    predictor: { update: () => {}, cancel: () => {} },
    timers: clock.timers,
    now: clock.now,
    describeError: (e) => String(e),
  });
  return { clock, state, turns, log, ctl, handle, cb: () => cb };
}

const f = (text: string) => ({ text, is_final: true });

describe("push to talk", () => {
  test("release waits 200 ms, finalizes, sends on <fin>", () => {
    const t = setup();
    t.ctl.keyDown();
    expect(t.state.transcript.listening).toBe(true);
    t.handle.connected = true;
    t.cb().onConnected();
    t.cb().onTokens([f("Book"), f(" a table")]);
    t.ctl.keyUp();
    t.clock.advance(199);
    expect(t.log).not.toContain("finalize");
    t.clock.advance(1);
    expect(t.log).toContain("finalize");
    t.cb().onTokens([f(" tonight")]);
    t.cb().onFinalized();
    expect(t.turns).toEqual(["Book a table tonight"]);
    expect(t.state.transcript.listening).toBe(false);
  });

  test("finalize wait is capped at 700 ms and falls back to interim words", () => {
    const t = setup();
    t.ctl.keyDown();
    t.handle.connected = true;
    t.cb().onConnected();
    t.cb().onTokens([f("Hello"), { text: " wor", is_final: false }]);
    t.ctl.keyUp();
    t.clock.advance(200 + 699);
    expect(t.turns).toEqual([]);
    t.clock.advance(1);
    expect(t.turns).toEqual(["Hello wor"]);
  });

  test("release before the socket opens finalizes once connected", () => {
    const t = setup();
    t.ctl.keyDown();
    t.ctl.keyUp();
    t.clock.advance(300);
    expect(t.log).not.toContain("finalize");
    t.handle.connected = true;
    t.cb().onConnected();
    expect(t.log).toContain("finalize");
    t.cb().onTokens([f("Hi there now")]);
    t.cb().onFinalized();
    expect(t.turns).toEqual(["Hi there now"]);
  });

  test("a silent press sends nothing", () => {
    const t = setup();
    t.ctl.keyDown();
    t.handle.connected = true;
    t.cb().onConnected();
    t.ctl.keyUp();
    t.clock.advance(1000);
    expect(t.turns).toEqual([]);
    expect(t.state.transcript.listening).toBe(false);
  });

  test("errors land in the transcript, not as throws", () => {
    const t = setup();
    t.ctl.keyDown();
    t.cb().onError(new Error("boom"));
    expect(t.state.transcript.error).toBe("Error: boom");
    expect(t.state.transcript.listening).toBe(false);
  });

  test("never-connecting socket gives up with an error", () => {
    const t = setup();
    t.ctl.keyDown();
    t.ctl.keyUp();
    t.clock.advance(5000);
    expect(t.state.transcript.error).toContain("timed out");
    expect(t.state.transcript.listening).toBe(false);
  });

  test("keyDown is ignored in hands-free mode", () => {
    const t = setup(true);
    t.ctl.keyDown();
    expect(t.state.transcript.listening).toBe(false);
  });
});

describe("hands-free", () => {
  test("each endpoint sends one utterance and listening continues", () => {
    const t = setup(true);
    t.ctl.syncHandsFree();
    expect(t.state.transcript.listening).toBe(true);
    t.cb().onTokens([f("First one")]);
    t.cb().onEndpoint();
    t.cb().onTokens([f("Second one")]);
    t.cb().onEndpoint();
    expect(t.turns).toEqual(["First one", "Second one"]);
    expect(t.state.transcript.listening).toBe(true);
    t.state.handsFree = false;
    t.ctl.syncHandsFree();
    expect(t.state.transcript.listening).toBe(false);
    expect(t.log).toContain("stop");
  });
});

describe("key provider", () => {
  test("caches until expiry minus 30 s, shares inflight fetches, refetches after invalidate", async () => {
    let now = 0;
    let calls = 0;
    const keys = createKeyProvider(async () => {
      calls++;
      return { api_key: "k" + calls, expires_at: new Date(60_000).toISOString() };
    }, () => now);
    const [a, b] = await Promise.all([keys.get(), keys.get()]);
    expect([a, b, calls]).toEqual(["k1", "k1", 1]);
    expect(keys.isReady()).toBe(true);
    now = 29_999;
    expect(await keys.get()).toBe("k1");
    now = 30_000;
    expect(await keys.get()).toBe("k2");
    keys.invalidate();
    expect(await keys.get()).toBe("k3");
  });

  test("a failed fetch flips ready off and rethrows", async () => {
    const keys = createKeyProvider(async () => {
      throw new Error("down");
    });
    await expect(keys.get()).rejects.toThrow("down");
    expect(keys.isReady()).toBe(false);
  });
});
