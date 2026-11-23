import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { store } from "@/store";
import { clearThreadWithWave, createWaveControl, type WaveHandle } from "./waveControl";

// The Esc path on stage: every branch of the wave's state machine, against the real store and a fake wave.

type FakeOpts = {
  prepareMs?: number;
  ready?: boolean;
  webgl?: boolean;
  iframe?: boolean;
  playThrows?: boolean;
  resetThrows?: boolean;
  debugThrows?: boolean;
};

function fakeWave(opts: FakeOpts = {}) {
  const calls = { prepare: 0, play: 0, reset: 0 };
  const debug = {
    webgl: opts.webgl ?? true,
    content: { ready: opts.ready ?? true, stale: false },
    revealed: { ready: opts.ready ?? true, stale: false },
  };
  const element = { querySelector: (sel: string) => (opts.iframe && sel === "iframe" ? {} : null) } as unknown as HTMLElement;
  const handle: WaveHandle = {
    element,
    controller: {
      get debug() {
        if (opts.debugThrows) throw new Error("debug");
        return debug;
      },
    },
    prepare: () => {
      calls.prepare++;
      return new Promise((resolve) => setTimeout(resolve, opts.prepareMs ?? 5));
    },
    play: () => {
      calls.play++;
      if (opts.playThrows) throw new Error("play");
    },
    reset: () => {
      calls.reset++;
      if (opts.resetThrows) throw new Error("reset");
    },
  };
  return { handle, calls };
}

function setup(opts: FakeOpts = {}) {
  const wave = fakeWave(opts);
  const armed: boolean[] = [];
  const warnings: string[] = [];
  let clears = 0;
  const control = createWaveControl({
    setArmed: (on) => armed.push(on),
    sourceOf: () => ({ x: 0, y: 0, w: 1, h: 1 }),
    budgetMs: 100,
    scheduleIdle: () => () => {},
    warn: (message) => warnings.push(message),
  });
  const detach = control.attach(wave.handle);
  const clear = () => {
    clears++;
    store.clearThread();
  };
  return { ...wave, control, detach, armed, warnings, clear, clears: () => clears, isArmed: () => armed.at(-1) ?? false };
}

function turn(text: string): string {
  const t = store.beginTurn({ input: { type: "utterance", text }, display: text, via: "text" });
  store.applyTurnEvent(t, { type: "done" });
  return t;
}
const threadIds = () => store.getState().thread.map((i) => i.id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let detachers: (() => void)[] = [];
beforeEach(() => {
  store.clearThread();
  turn("dinner nearby");
  turn("for six");
});
afterEach(() => {
  for (const d of detachers) d();
  detachers = [];
  store.clearThread();
});
const track = <T extends { detach: (() => void) | undefined }>(s: T): T => {
  if (s.detach) detachers.push(s.detach);
  return s;
};

describe("Esc clears at once, without the wave", () => {
  test("an empty thread: nothing is pictured", async () => {
    const s = track(setup());
    store.clearThread();
    await s.control.run(s.clear);
    expect(s.clears()).toBe(1);
    expect(s.calls.prepare).toBe(0);
  });
  test("an iframe (HTML mode) in the thread: nothing is pictured", async () => {
    const s = track(setup({ iframe: true }));
    await s.control.run(s.clear);
    expect(s.clears()).toBe(1);
    expect(s.calls.prepare).toBe(0);
    expect(store.getState().thread).toHaveLength(0);
  });
  test("pictures miss the budget: clear without play, capture off", async () => {
    const s = track(setup({ prepareMs: 300 }));
    await s.control.run(s.clear);
    expect(s.calls.play).toBe(0);
    expect(s.clears()).toBe(1);
    expect(store.getState().thread).toHaveLength(0);
    expect(s.isArmed()).toBe(false);
  });
  test("pictures never current (two rounds): clear without play", async () => {
    const s = track(setup({ ready: false }));
    await s.control.run(s.clear);
    expect(s.calls.prepare).toBe(2);
    expect(s.calls.play).toBe(0);
    expect(store.getState().thread).toHaveLength(0);
    expect(s.isArmed()).toBe(false);
  });
  test("the wave was unmounted during the wait: still clears", async () => {
    const s = track(setup({ prepareMs: 20 }));
    const pending = s.control.run(s.clear);
    s.detach?.();
    await pending;
    expect(s.calls.play).toBe(0);
    expect(store.getState().thread).toHaveLength(0);
  });
  test("no wave mounted: clearThreadWithWave clears directly", async () => {
    let clears = 0;
    await clearThreadWithWave(() => {
      clears++;
      store.clearThread();
    });
    expect(clears).toBe(1);
    expect(store.getState().thread).toHaveLength(0);
  });
});

describe("the thread moves while it is being pictured", () => {
  test("a second Esc inside the wait clears once; the first run neither clears again nor waves", async () => {
    const s = track(setup({ prepareMs: 30 }));
    const first = s.control.run(s.clear);
    await s.control.run(s.clear); // busy: plain clear
    expect(s.clears()).toBe(1);
    await first;
    expect(s.clears()).toBe(1);
    expect(s.calls.play).toBe(0);
    expect(s.isArmed()).toBe(false);
  });
  test("regression 4107e6e: a turn begun inside the wait is kept, not wiped", async () => {
    const s = track(setup({ prepareMs: 30 }));
    const before = threadIds();
    const pending = s.control.run(s.clear);
    await sleep(5);
    const t = store.beginTurn({ input: { type: "utterance", text: "late voice turn" }, display: "late voice turn", via: "voice" });
    await pending;
    expect(s.clears()).toBe(0);
    expect(s.calls.play).toBe(0);
    expect(threadIds()).toEqual([...before, ...store.getState().thread.slice(-2).map((i) => i.id)]);
    expect(store.getState().thread.some((i) => i.turnId === t)).toBe(true);
    expect(s.isArmed()).toBe(false);
  });
  test("an existing item updated inside the wait (no new turn) still waves and clears", async () => {
    const s = track(setup({ prepareMs: 30 }));
    const last = store.getState().thread.at(-1);
    const pending = s.control.run(s.clear);
    await sleep(5);
    if (last) store.applyTurnEvent(last.turnId, { type: "caption", text: "late caption" });
    await pending;
    expect(s.calls.play).toBe(1);
    expect(s.clears()).toBe(1);
    expect(store.getState().thread).toHaveLength(0);
  });
});

describe("the wave runs", () => {
  test("play, then clear; capture stays on until the wave ends", async () => {
    const s = track(setup());
    await s.control.run(s.clear);
    expect(s.calls.play).toBe(1);
    expect(store.getState().thread).toHaveLength(0);
    expect(s.isArmed()).toBe(true);
    s.control.finish();
    expect(s.calls.reset).toBe(1);
    expect(s.isArmed()).toBe(false);
  });
  test("a turn begun after play cuts the wave (U2) and disarms; the next Esc waves again", async () => {
    const s = track(setup());
    await s.control.run(s.clear);
    turn("next question");
    await Promise.resolve(); // the reset is deferred out of the store's listener loop
    expect(s.calls.reset).toBe(1);
    expect(s.isArmed()).toBe(false);
    expect(store.getState().thread).toHaveLength(2);
    await s.control.run(s.clear);
    expect(s.calls.play).toBe(2);
  });
});

describe("the wave library throws: Esc still clears and capture goes off", () => {
  test("play throws: thread cleared, wave dropped, disarmed, one warning", async () => {
    const s = track(setup({ playThrows: true }));
    await s.control.run(s.clear);
    expect(store.getState().thread).toHaveLength(0);
    expect(s.clears()).toBe(1);
    expect(s.isArmed()).toBe(false);
    expect(s.warnings).toEqual(["[wave] Esc fell back to a plain clear"]);
    // Not stuck busy: the next Esc runs the whole path again.
    turn("again");
    await s.control.run(s.clear);
    expect(s.calls.play).toBe(2);
  });
  test("the debug getter throws: plain clear, disarmed, no rejection", async () => {
    const s = track(setup({ debugThrows: true }));
    await expect(s.control.run(s.clear)).resolves.toBeUndefined();
    expect(store.getState().thread).toHaveLength(0);
    expect(s.calls.play).toBe(0);
    expect(s.isArmed()).toBe(false);
  });
  test("reset throws when a new turn cuts the wave: the turn and every other store listener are unharmed", async () => {
    const s = track(setup({ resetThrows: true }));
    await s.control.run(s.clear);
    let laterListener = 0;
    const off = store.subscribe(() => laterListener++);
    expect(() => turn("next question")).not.toThrow();
    await Promise.resolve();
    off();
    expect(laterListener).toBeGreaterThan(0);
    expect(store.getState().thread).toHaveLength(2);
    expect(s.calls.reset).toBe(1);
    expect(s.isArmed()).toBe(false);
    expect(s.warnings).toEqual(["[wave] reset failed"]);
  });
  test("reset throws in onFinish: disarmed, warned, nothing escapes", () => {
    const s = track(setup({ resetThrows: true }));
    return s.control.run(s.clear).then(() => {
      expect(() => s.control.finish()).not.toThrow();
      expect(s.isArmed()).toBe(false);
    });
  });
});

describe("warm-up", () => {
  test("waits while a turn runs, then pictures once with capture on and turns it off again", async () => {
    const wave = fakeWave();
    const armed: boolean[] = [];
    const idle: (() => void)[] = [];
    const control = createWaveControl({
      setArmed: (on) => armed.push(on),
      sourceOf: () => ({ x: 0, y: 0, w: 1, h: 1 }),
      scheduleIdle: (fn) => {
        idle.push(fn);
        return () => {};
      },
      warn: () => {},
    });
    const detach = control.attach(wave.handle);
    if (detach) detachers.push(detach);
    const t = store.beginTurn({ input: { type: "utterance", text: "running" }, display: "running", via: "text" });
    idle.shift()?.();
    expect(wave.calls.prepare).toBe(0);
    expect(idle).toHaveLength(1);
    store.applyTurnEvent(t, { type: "done" });
    idle.shift()?.();
    expect(wave.calls.prepare).toBe(1);
    expect(armed.at(-1)).toBe(true);
    await sleep(20);
    expect(armed.at(-1)).toBe(false);
  });
});
