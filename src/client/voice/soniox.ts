/**
 * Soniox wrapper: temporary-key cache, SDK recording, and the push-to-talk / hands-free controller.
 * The controller takes its collaborators as arguments (store, sendTurn, recorder, timers) so the
 * state machine is testable without a browser. Errors never throw into React: they land in the transcript.
 */
import {
  AudioDeviceError,
  AudioPermissionError,
  AudioUnavailableError,
  AuthError,
  ConnectionError,
  NetworkError,
  QuotaError,
  SonioxClient,
} from "@soniox/client";
import { apiFetch } from "../apiBase";
import type { SonioxKeyResponse } from "../../shared/protocol";
import type { StoreApi, UserItem } from "../state";
import type { PredictScheduler } from "./predictClient";
import { realTimers, TranscriptAssembler, type Timers, type TokenLike } from "./transcript";

export const SONIOX_MODEL = "stt-rt-v6";
export const LANGUAGE_HINTS = ["en", "de"];
/** Spec: keep streaming this long after release so the last word is not clipped. */
export const TRAILING_AUDIO_MS = 200;
/** Spec: how long to wait for final tokens after asking for finalization. */
export const FINALIZE_WAIT_MS = 700;
/** Safety net when the socket never opens (offline, key rejected silently). */
export const CONNECT_GIVE_UP_MS = 4000;
const KEY_MARGIN_MS = 30_000;

/** Error with a message that is already fit for the status line. */
export class VoiceError extends Error {}

// ---- temporary key ----------------------------------------------------------------------------

export type KeyProvider = {
  /** Cached key when still valid, otherwise a fresh one (concurrent calls share one request). */
  get(): Promise<string>;
  /** Fetches a new key now, regardless of the cache. */
  refresh(): Promise<string>;
  /** Forget the cached key (auth error, key used up). */
  invalidate(): void;
  /** Milliseconds the cached key stays usable, 0 when none. */
  remainingMs(): number;
  /** True once a key has been fetched and the last fetch did not fail. */
  isReady(): boolean;
  subscribe(listener: () => void): () => void;
};

export function createKeyProvider(
  fetchKey: () => Promise<SonioxKeyResponse>,
  now: () => number = Date.now,
): KeyProvider {
  let cached: { key: string; usableUntil: number } | null = null;
  let inflight: Promise<string> | null = null;
  let ready = false;
  const listeners = new Set<() => void>();
  const setReady = (v: boolean) => {
    if (v === ready) return;
    ready = v;
    for (const l of listeners) l();
  };

  const refresh = (): Promise<string> => {
    inflight ??= fetchKey()
      .then((res) => {
        const expires = Date.parse(res.expires_at);
        // Unparseable expiry: assume the documented 60 s lifetime rather than caching forever.
        const usableUntil = (Number.isFinite(expires) ? expires : now() + 60_000) - KEY_MARGIN_MS;
        cached = { key: res.api_key, usableUntil };
        setReady(true);
        return res.api_key;
      })
      .catch((err: unknown) => {
        cached = null;
        setReady(false);
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };

  return {
    get: () => (cached && now() < cached.usableUntil ? Promise.resolve(cached.key) : refresh()),
    refresh,
    invalidate: () => {
      cached = null;
    },
    remainingMs: () => (cached ? Math.max(0, cached.usableUntil + KEY_MARGIN_MS - now()) : 0),
    isReady: () => ready,
    subscribe: (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
  };
}

async function fetchKeyFromWorker(): Promise<SonioxKeyResponse> {
  let res: Response;
  try {
    res = await apiFetch("/api/soniox-key");
  } catch (cause) {
    throw new VoiceError("Voice unavailable: cannot reach the server.", { cause });
  }
  if (res.status === 401) throw new VoiceError("Voice unavailable: demo key rejected.");
  if (!res.ok) throw new VoiceError(`Voice unavailable: speech service error (${res.status}).`);
  const body = (await res.json()) as Partial<SonioxKeyResponse>;
  if (typeof body.api_key !== "string" || typeof body.expires_at !== "string") {
    throw new VoiceError("Voice unavailable: bad key response.");
  }
  return { api_key: body.api_key, expires_at: body.expires_at };
}

export const sonioxKeys: KeyProvider = createKeyProvider(fetchKeyFromWorker);

// ---- SDK recording ----------------------------------------------------------------------------

const BASE_TERMS = ["Bremen", "New York", "A2UI", "Brick Box", "Jonas"];
let extraTerms: string[] = [];
/** Place names for recognition context; set once from the worker's places data. */
export function setContextTerms(terms: readonly string[]): void {
  extraTerms = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].slice(0, 200);
}

export type RecordingCallbacks = {
  onTokens(tokens: readonly TokenLike[]): void;
  onEndpoint(): void;
  onFinalized(): void;
  onConnected(): void;
  onError(err: unknown): void;
};

export type RecordingHandle = {
  readonly connected: boolean;
  /** Ask the server to finalize all pending tokens; `<fin>` follows. */
  finalize(): void;
  /** Stop the mic and close gracefully without waiting. */
  stop(): void;
  cancel(): void;
};

export type StartRecording = (opts: { handsFree: boolean }, cb: RecordingCallbacks) => RecordingHandle;

let client: SonioxClient | null = null;
function getClient(): SonioxClient {
  // The config function runs once per recording: it hands over the cached key, so a press never waits on a fetch
  // (and the mic already buffers while the socket opens).
  client ??= new SonioxClient({ config: async () => ({ api_key: await sonioxKeys.get() }) });
  return client;
}

export const startSonioxRecording: StartRecording = (opts, cb) => {
  const rec = getClient().realtime.record({
    model: SONIOX_MODEL,
    language_hints: LANGUAGE_HINTS,
    context: {
      general: [{ key: "domain", value: "voice commands for building a small booking or planning interface" }],
      terms: [...BASE_TERMS, ...extraTerms],
    },
    enable_endpoint_detection: opts.handsFree,
    ...(opts.handsFree ? { auto_reconnect: true } : {}),
  });
  let connected = false;
  rec.on("connected", () => {
    connected = true;
    cb.onConnected();
  });
  rec.on("result", (r) => cb.onTokens(r.tokens));
  rec.on("endpoint", () => cb.onEndpoint());
  rec.on("finalized", () => cb.onFinalized());
  rec.on("error", (e) => cb.onError(e));
  return {
    get connected() {
      return connected;
    },
    finalize: () => {
      try {
        rec.finalize();
      } catch (e) {
        cb.onError(e);
      }
    },
    stop: () => {
      try {
        rec.stop().catch(() => {});
      } catch {
        rec.cancel();
      }
    },
    cancel: () => {
      try {
        rec.cancel();
      } catch {
        /* already closed */
      }
    },
  };
};

/** Short, speakable-on-stage messages. Also drops the cached key when it was the problem. */
export function describeVoiceError(err: unknown, keys: Pick<KeyProvider, "invalidate"> = sonioxKeys): string {
  if (err instanceof VoiceError) return err.message;
  if (err instanceof AudioPermissionError) return "Microphone blocked. Allow it in the address bar and press Space again.";
  if (err instanceof AudioDeviceError) return "No microphone found.";
  if (err instanceof AudioUnavailableError) return "This browser cannot record audio.";
  if (err instanceof AuthError) {
    keys.invalidate();
    return "Speech key rejected. Press Space to retry.";
  }
  if (err instanceof QuotaError) return "Speech quota reached.";
  if (err instanceof ConnectionError || err instanceof NetworkError) return "Speech connection lost. Press Space to retry.";
  return err instanceof Error && err.message ? `Voice error: ${err.message}` : "Voice error.";
}

// ---- controller -------------------------------------------------------------------------------

export type VoiceStore = Pick<
  StoreApi,
  "getState" | "setTranscript" | "addPredicted" | "clearPredicted" | "setHandsFree"
>;

export type VoiceDeps = {
  store: VoiceStore;
  sendTurn: (opts: { input: { type: "utterance"; text: string }; display: string; via: UserItem["via"] }) => unknown;
  start: StartRecording;
  predictor: PredictScheduler;
  /** Called after any recording ends so the key stays warm for the next press. */
  onSessionEnd?: () => void;
  describeError?: (err: unknown) => string;
  timers?: Timers;
  now?: () => number;
};

export type VoiceTiming = { connectMs: number | null; firstTokenMs: number | null };
const timings: VoiceTiming[] = [];
/** Per press: ms from keydown to socket open and to the first token (null when not reached). For the report. */
export function getVoiceTimings(): readonly VoiceTiming[] {
  return timings;
}

type Session = {
  asm: TranscriptAssembler;
  handle: RecordingHandle;
  handsFree: boolean;
  done: boolean;
  pendingFinalize: boolean;
  finalizing: boolean;
  needClearPredicted: boolean;
  timerHandles: unknown[];
  timing: VoiceTiming;
  pressedAt: number;
};

export type VoiceController = {
  keyDown(): void;
  keyUp(): void;
  /** Mirror the store's handsFree flag. */
  syncHandsFree(): void;
  dispose(): void;
};

export function createVoiceController(deps: VoiceDeps): VoiceController {
  const { store, predictor } = deps;
  const timers = deps.timers ?? realTimers;
  const now = deps.now ?? (() => performance.now());
  const describe = deps.describeError ?? describeVoiceError;
  let current: Session | null = null;
  // "held" = key down, "draining" = key up, waiting for finals, "hf" = hands-free recording.
  let phase: "idle" | "held" | "draining" | "hf" = "idle";
  let disposed = false;

  const later = (s: Session, fn: () => void, ms: number) => {
    s.timerHandles.push(timers.set(fn, ms));
  };
  const clearTimers = (s: Session) => {
    for (const h of s.timerHandles) timers.clear(h);
    s.timerHandles = [];
  };

  const publish = (s: Session) => {
    const v = s.asm.view();
    store.setTranscript({ final: v.final, interim: v.interim });
    predictor.update(s.asm.fullText());
  };

  const open = (handsFree: boolean): Session => {
    const s: Session = {
      asm: new TranscriptAssembler(),
      handle: undefined as unknown as RecordingHandle,
      handsFree,
      done: false,
      pendingFinalize: false,
      finalizing: false,
      needClearPredicted: false,
      timerHandles: [],
      timing: { connectMs: null, firstTokenMs: null },
      pressedAt: now(),
    };
    timings.push(s.timing);
    s.handle = deps.start(
      { handsFree },
      {
        onTokens: (tokens) => {
          if (s.done || current !== s) return;
          if (s.timing.firstTokenMs === null && tokens.length > 0) s.timing.firstTokenMs = now() - s.pressedAt;
          if (s.needClearPredicted && tokens.length > 0) {
            s.needClearPredicted = false;
            store.clearPredicted();
          }
          s.asm.feed(tokens);
          publish(s);
        },
        onEndpoint: () => {
          if (s.done || current !== s || !s.handsFree) return;
          const text = s.asm.takeFinal();
          predictor.cancel();
          s.needClearPredicted = true;
          store.setTranscript({ final: "", interim: "" });
          if (text) send(text);
        },
        onFinalized: () => {
          if (s.done || current !== s || s.handsFree || !s.finalizing) return;
          complete(s);
        },
        onConnected: () => {
          if (s.done || current !== s) return;
          s.timing.connectMs = now() - s.pressedAt;
          if (s.pendingFinalize) requestFinalize(s);
        },
        onError: (err) => fail(s, err),
      },
    );
    current = s;
    return s;
  };

  const send = (text: string) => {
    deps.sendTurn({ input: { type: "utterance", text }, display: text, via: "voice" });
  };

  const end = (s: Session) => {
    s.done = true;
    clearTimers(s);
    predictor.cancel();
    if (current === s) current = null;
    s.handle.stop();
    deps.onSessionEnd?.();
  };

  const fail = (s: Session, err: unknown) => {
    if (s.done) return;
    console.error("[voice] recording error", err);
    s.done = true;
    clearTimers(s);
    predictor.cancel();
    if (current === s) current = null;
    s.handle.cancel();
    phase = "idle";
    store.setTranscript({ error: describe(err), listening: false });
    if (s.handsFree && store.getState().handsFree) store.setHandsFree(false);
    deps.onSessionEnd?.();
  };

  const requestFinalize = (s: Session) => {
    s.pendingFinalize = false;
    s.finalizing = true;
    s.handle.finalize();
    // `<fin>` normally ends the wait sooner; this cap keeps a slow server from stalling the turn.
    later(s, () => complete(s), FINALIZE_WAIT_MS);
  };

  const complete = (s: Session) => {
    if (s.done) return;
    // Also reached when a new press preempts the trailing window or the cap fires before every token is final:
    // interim words are better than dropping speech.
    const text = s.asm.fullText();
    end(s);
    phase = "idle";
    store.setTranscript({ final: text, interim: "", listening: false });
    if (text) send(text);
    syncHandsFree();
  };

  const keyDown = () => {
    if (disposed || store.getState().handsFree) return;
    if (phase === "draining" && current) complete(current);
    if (phase !== "idle") return;
    predictor.cancel();
    store.clearPredicted();
    store.setTranscript({ final: "", interim: "", listening: true, error: undefined });
    phase = "held";
    open(false);
  };

  const keyUp = () => {
    const s = current;
    if (phase !== "held" || !s) return;
    phase = "draining";
    // Safety net for a socket that never opens.
    later(s, () => {
      if (s.done) return;
      fail(s, new VoiceError("Voice connection timed out. Press Space to retry."));
    }, TRAILING_AUDIO_MS + CONNECT_GIVE_UP_MS);
    later(s, () => {
      if (s.done) return;
      if (s.handle.connected) requestFinalize(s);
      else s.pendingFinalize = true;
    }, TRAILING_AUDIO_MS);
  };

  function syncHandsFree() {
    if (disposed) return;
    const want = store.getState().handsFree;
    if (want && phase === "idle") {
      phase = "hf";
      predictor.cancel();
      store.clearPredicted();
      store.setTranscript({ final: "", interim: "", listening: true, error: undefined });
      open(true);
    } else if (!want && phase === "hf" && current) {
      end(current);
      phase = "idle";
      store.setTranscript({ final: "", interim: "", listening: false });
    }
  }

  return {
    keyDown,
    keyUp,
    syncHandsFree,
    dispose: () => {
      disposed = true;
      if (current && !current.done) end(current);
      phase = "idle";
    },
  };
}
