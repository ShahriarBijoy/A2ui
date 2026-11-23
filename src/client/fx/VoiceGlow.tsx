import { useState, useSyncExternalStore, type ReactNode } from "react";
import { VoiceBeam } from "voice-glow";
import { store } from "@/store";
import { micStream } from "@/voice/micTap";
import { prefersReducedMotion, useReducedMotion } from "./reducedMotion";
import { createSweep, glowPhase, type GlowPhase } from "./voiceSweep";

// Brick Box's warm palette in place of the default spectrum: highlight at the centre, then amber, rose and
// brick pairs outward. Deeper than the tokens themselves because the light theme lays them at low opacity.
const COLORS = ["#e0714f", "#ee9440", "#d2566f", "#f2b33d", "#c4472f", "#e9835f", "#b45a78"];
const BAND = { core: "#e0714f", above: "#f2b33d", mid: "#d2566f", below: "#a63e26" };

const readSweep = () => ({ processing: glowPhase(store.getState()) === "processing", reduced: prefersReducedMotion() });

/**
 * The composer's glow: the live microphone while Space is held, a sweeping beam while a turn runs, gone
 * otherwise. The stream is the voice lane's own recording (micTap), never a second microphone.
 */
export function VoiceGlow({ phase, className, children }: { phase: GlowPhase; className?: string; children: ReactNode }) {
  const stream = useSyncExternalStore(micStream.subscribe, micStream.get, () => null);
  const reduced = useReducedMotion();
  // Created once and sampled by the beam's own frame loop.
  const [motion] = useState(() => createSweep(readSweep));
  return (
    <VoiceBeam
      type="default"
      theme="light"
      className={className}
      active={phase !== "off"}
      stream={phase === "listening" ? stream : null}
      motion={motion}
      colors={COLORS}
      bandColors={BAND}
      // The light theme drifts ±40° by default, which walks the palette off-brand into greens and blues.
      staticColors
      // The library keeps the meter live under reduced motion (it calls it a meter, not decoration); the stage
      // dims it to a hint instead, and the sweep above stands still.
      strength={reduced ? 0.3 : 1}
      scale={1.35}
      // Projector light washes pastels out: deeper colour and stronger layers than the light theme's defaults,
      // and less of the white epicentre that would bleach the centre lobe.
      saturation={1.9}
      innerOpacity={1.4}
      bloomOpacity={1.4}
      strokeOpacity={1.6}
      coreLight={0.8}
    >
      {children}
    </VoiceBeam>
  );
}
