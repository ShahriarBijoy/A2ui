/**
 * The microphone stream of the recording in progress, for the bottom bar's glow.
 * The Soniox SDK opens the microphone itself; tapping its source means the glow never asks for a second
 * getUserMedia (a second device handle, and on some setups a second permission path, on stage).
 */
import { MicrophoneSource, type AudioSourceHandlers } from "@soniox/client";

export type StreamSlot = {
  get(): MediaStream | null;
  subscribe(listener: () => void): () => void;
  /** Publishes a stream. The returned release clears it only while it is still the current one. */
  publish(stream: MediaStream): () => void;
};

export function createStreamSlot(): StreamSlot {
  let current: MediaStream | null = null;
  const listeners = new Set<() => void>();
  const set = (next: MediaStream | null) => {
    if (next === current) return;
    current = next;
    for (const l of listeners) l();
  };
  return {
    get: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    publish(stream) {
      set(stream);
      // A new press can start before the previous recording's stop lands; that late stop must not blank it.
      return () => {
        if (current === stream) set(null);
      };
    },
  };
}

/** The live microphone stream while a recording runs, else null. */
export const micStream: StreamSlot = createStreamSlot();

function isMediaStream(value: unknown): value is MediaStream {
  return typeof MediaStream !== "undefined" && value instanceof MediaStream;
}

/**
 * The SDK's own microphone source, publishing its stream. Subclassing keeps pause/resume/restart (used by
 * hands-free reconnects) exactly as shipped. `stream` is TypeScript-private in @soniox/client 2.5.0, so it is
 * read through a cast and checked; if a later SDK renames it, the glow just stays at rest (micTap.test.ts fails).
 */
export class TappedMicrophoneSource extends MicrophoneSource {
  private slot: StreamSlot;
  private release: (() => void) | null = null;

  constructor(slot: StreamSlot = micStream) {
    super();
    this.slot = slot;
  }

  override async start(handlers: AudioSourceHandlers): Promise<void> {
    await super.start(handlers);
    const stream = (this as unknown as { stream?: unknown }).stream;
    if (!isMediaStream(stream)) return;
    this.release?.();
    this.release = this.slot.publish(stream);
  }

  override stop(): void {
    super.stop();
    this.release?.();
    this.release = null;
  }
}
