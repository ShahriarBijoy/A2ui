import { describe, expect, test } from "bun:test";
import { createSweep, glowPhase, stepSweep, type SweepState } from "./voiceSweep";

const st = (over: Partial<Parameters<typeof glowPhase>[0]> = {}) => ({
  activeTurnId: null,
  handsFree: false,
  transcript: { final: "", interim: "", listening: false },
  ...over,
});
const listening = { final: "", interim: "", listening: true };

describe("glowPhase", () => {
  test("off at rest", () => expect(glowPhase(st())).toBe("off"));
  test("holding Space lights the meter, even while a turn still runs", () => {
    expect(glowPhase(st({ transcript: listening }))).toBe("listening");
    expect(glowPhase(st({ transcript: listening, activeTurnId: "t1" }))).toBe("listening");
  });
  test("a running turn sweeps", () => expect(glowPhase(st({ activeTurnId: "t1" }))).toBe("processing"));
  test("hands-free: the sweep wins while a turn runs, the meter otherwise", () => {
    expect(glowPhase(st({ handsFree: true, transcript: listening, activeTurnId: "t1" }))).toBe("processing");
    expect(glowPhase(st({ handsFree: true, transcript: listening }))).toBe("listening");
  });
});

const run = (frames: number, dt: number, processing: boolean, reduced = false, from: SweepState = { gather: 0, phase: 0 }) => {
  let s = from;
  let motion = null as ReturnType<typeof stepSweep>["motion"];
  for (let i = 0; i < frames; i++) ({ state: s, motion } = stepSweep(s, dt, processing, reduced));
  return { s, motion };
};

describe("stepSweep", () => {
  test("at rest it leaves the voice glow alone", () => {
    expect(run(10, 1 / 60, false).motion).toBeNull();
  });
  test("gathers in over a few frames, not at once", () => {
    const one = run(1, 1 / 60, true).motion;
    expect(one?.gather).toBeGreaterThan(0);
    expect(one?.gather).toBeLessThan(0.2);
    expect(run(60, 1 / 60, true).motion?.gather).toBe(1);
  });
  test("travels both ways within its reach", () => {
    const offsets: number[] = [];
    let s: SweepState = { gather: 1, phase: 0 };
    for (let i = 0; i < 150; i++) {
      const out = stepSweep(s, 1 / 60, true, false);
      s = out.state;
      offsets.push(out.motion?.offset ?? 0);
    }
    expect(Math.max(...offsets)).toBeGreaterThan(0.6);
    expect(Math.min(...offsets)).toBeLessThan(-0.6);
    expect(Math.max(...offsets.map(Math.abs))).toBeLessThanOrEqual(0.72 + 1e-9);
  });
  test("releases back to the voice glow when the turn ends", () => {
    const busy = run(60, 1 / 60, true).s;
    expect(run(2, 1 / 60, false, false, busy).motion?.gather).toBeGreaterThan(0);
    expect(run(90, 1 / 60, false, false, busy).motion).toBeNull();
  });
  test("a long gap (beam was inactive) is clamped to one short step", () => {
    const out = stepSweep({ gather: 0, phase: 0 }, 30, true, false);
    expect(out.motion?.gather).toBeLessThan(1);
  });
  test("after a long gap (the beam was inactive) it starts from rest, not from the old gathered beam", () => {
    let t = 0;
    let processing = true;
    const sweep = createSweep(() => ({ processing, reduced: false }), () => t);
    for (let i = 0; i < 60; i++) {
      sweep();
      t += 1000 / 60;
    }
    expect(sweep()?.gather).toBe(1);
    // The turn ends and the beam fades out; the driver stops sampling. Two seconds later Space is pressed.
    processing = false;
    t += 2000;
    expect(sweep()).toBeNull();
  });
  test("short gaps keep easing from where it was", () => {
    let t = 0;
    let processing = true;
    const sweep = createSweep(() => ({ processing, reduced: false }), () => t);
    for (let i = 0; i < 60; i++) {
      sweep();
      t += 1000 / 60;
    }
    processing = false;
    t += 100;
    expect(sweep()?.gather).toBeGreaterThan(0);
  });
  test("reduced motion: a still beam at the centre, no easing", () => {
    const out = run(5, 1 / 60, true, true).motion;
    expect(out).toEqual({ gather: 1, offset: 0, heldLevel: 0.6 });
    expect(run(1, 1 / 60, false, true).motion).toBeNull();
  });
});
