import { useSyncExternalStore } from "react";
import { BrowserPermissionResolver } from "@soniox/client";
import { store } from "@/store";
import { sendTurn } from "@/turns";
import { createPredictor } from "./predictClient";
import {
  createVoiceController,
  describeVoiceError,
  setContextTerms,
  sonioxKeys,
  startSonioxRecording,
  type VoiceController,
} from "./soniox";
import { useMountEffect } from "./useMountEffect";
import { isInPopup, isTypingTarget as isEditableTextEntry } from "@/keyboard";

export type VoiceState = { supported: boolean; ready: boolean; listening: boolean; error?: string };

// Words the talk says that recognition would otherwise miss: the venue, its district, the flight line.
// Static on purpose: there is no fixed place list any more (live search).
const CONTEXT_TERMS = ["Bremen", "Überseestadt", "New York", "A2UI", "Brick Box", "JAAI"];

function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && isEditableTextEntry(target);
}

/** Space inside an open menu or confirm dialog belongs to that popup, not to the microphone behind it. */
function inPopup(target: EventTarget | null): boolean {
  return target instanceof Element && isInPopup(target);
}

const supportsAudio = () =>
  typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof MediaRecorder !== "undefined";

export function useVoice(): VoiceState {
  const supported = supportsAudio();
  const ready = useSyncExternalStore(sonioxKeys.subscribe, sonioxKeys.isReady);
  const listening = useSyncExternalStore(store.subscribe, () => store.getState().transcript.listening);
  const error = useSyncExternalStore(store.subscribe, () => store.getState().transcript.error);

  useMountEffect(() => {
    if (!supported) {
      store.setTranscript({ error: "This browser cannot record audio." });
      return;
    }
    setContextTerms(CONTEXT_TERMS);
    const warm = () => {
      sonioxKeys.refresh().catch((err: unknown) => {
        console.error("[voice] key prefetch failed", err);
        store.setTranscript({ error: describeVoiceError(err) });
      });
    };
    warm();
    // Ask for the mic now, not on the first Space, so the permission prompt never eats the first utterance.
    const mic = new BrowserPermissionResolver();
    void mic
      .check("microphone")
      .then((r) => (r.status === "prompt" ? mic.request("microphone") : r))
      .then((r) => {
        if (r.status === "denied") store.setTranscript({ error: "Microphone blocked. Allow it in the address bar." });
      })
      .catch((err: unknown) => console.error("[voice] mic permission check failed", err));

    const controller: VoiceController = createVoiceController({
      store,
      sendTurn,
      start: startSonioxRecording,
      predictor: createPredictor(store),
      // The key lives ~60 s; top it up so the next press never waits on a fetch.
      onSessionEnd: () => {
        if (sonioxKeys.remainingMs() < 40_000) warm();
      },
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || inPopup(e.target) || store.getState().handsFree) return;
      e.preventDefault();
      if (e.repeat) return;
      controller.keyDown();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      if (!isTypingTarget(e.target)) e.preventDefault();
      controller.keyUp();
    };
    // Focus leaving the window would swallow the keyup and leave the mic open.
    const onBlur = () => controller.keyUp();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    const unsubscribe = store.subscribe(() => controller.syncHandsFree());
    controller.syncHandsFree();
    const keepWarm = window.setInterval(() => {
      if (document.visibilityState === "visible" && sonioxKeys.remainingMs() < 40_000) warm();
    }, 10_000);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      window.clearInterval(keepWarm);
      unsubscribe();
      controller.dispose();
    };
  });

  return { supported, ready, listening, ...(error ? { error } : {}) };
}
