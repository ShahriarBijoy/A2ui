/**
 * What the bottom bar's glow shows, and the "processing" sweep.
 * voice-glow 0.5 ships processing only as a Pro hook built on its public `motion` input, so the sweep is
 * written here on that same input: the lobes gather into one beam that travels the width while a turn runs.
 */
import type { VoiceBeamMotion } from "voice-glow";
import type { AppState } from "@/state";

export type GlowPhase = "off" | "listening" | "processing";

/**
 * Holding Space wins over a running turn (the speaker is talking again). Hands-free listens all the time,
 * so there a running turn shows the sweep instead.
 */
export function glowPhase(s: Pick<AppState, "activeTurnId" | "handsFree" | "transcript">): GlowPhase {
  const listening = s.transcript.listening;
  if (listening && !s.handsFree) return "listening";
  if (s.activeTurnId !== null) return "processing";
  return listening ? "listening" : "off";
}

export type SweepState = { gather: number; phase: number };

/** Seconds for the gather to ease in or out: quick enough to read as one gesture, not a pop. */
const GATHER_TAU_S = 0.16;
/** One left-right-left trip. */
const SWEEP_PERIOD_S = 2.4;
/** How far the beam travels, in half-widths of the lobe ring. */
const SWEEP_REACH = 0.72;
/** The level the gathered beam holds, so it carries colour with no voice behind it. */
const HELD_LEVEL = 0.6;

/** One frame. Pure: the caller keeps the state and the clock. */
export function stepSweep(
  s: SweepState,
  dtS: number,
  processing: boolean,
  reduced: boolean,
): { state: SweepState; motion: VoiceBeamMotion | null } {
  const target = processing ? 1 : 0;
  if (reduced) {
    // No travel and no morph: a still beam at the centre says "working" without moving.
    return { state: { gather: target, phase: 0 }, motion: target ? { gather: 1, offset: 0, heldLevel: HELD_LEVEL } : null };
  }
  const dt = Math.min(Math.max(dtS, 0), 0.1);
  let gather = s.gather + (target - s.gather) * (1 - Math.exp(-dt / GATHER_TAU_S));
  if (Math.abs(target - gather) < 0.002) gather = target;
  if (gather === 0) return { state: { gather: 0, phase: 0 }, motion: null };
  const phase = (s.phase + (dt * 2 * Math.PI) / SWEEP_PERIOD_S) % (2 * Math.PI);
  return {
    state: { gather, phase },
    motion: {
      gather,
      offset: SWEEP_REACH * Math.sin(phase),
      // A little wider while it moves fastest (the centre of each pass).
      stretch: 0.35 * Math.abs(Math.cos(phase)) * gather,
      heldLevel: HELD_LEVEL,
    },
  };
}

/** A `motion` getter for VoiceBeam: sampled every frame by its driver, so no React render per frame. */
export function createSweep(read: () => { processing: boolean; reduced: boolean }): () => VoiceBeamMotion | null {
  let state: SweepState = { gather: 0, phase: 0 };
  let last: number | null = null;
  return () => {
    const now = performance.now();
    // The driver stops calling while the beam is inactive; a long gap is not a long step.
    const dt = last === null ? 0 : (now - last) / 1000;
    last = now;
    const { processing, reduced } = read();
    const out = stepSweep(state, dt, processing, reduced);
    state = out.state;
    return out.motion;
  };
}
