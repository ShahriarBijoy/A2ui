/**
 * What the stage's keys and buttons do, shared by both layouts (App = ?classic, StageApp = layout A).
 * Session changes stop the live turn and the replay first, so none of their events land in the next session.
 */
import { clearThreadWithWave } from "@/fx/waveControl";
import type { Shortcut } from "@/keyboard";
import { cancelReplay, copyReplaysJson, playReplay, saveLastTurn } from "@/replay";
import { store } from "@/store";
import { abortTurn } from "@/turns";

/**
 * The Esc clear while it runs. The wave keeps the thread when a turn begins mid-clear (a live turn's newer intent
 * wins), so a replay key pressed right after Esc waits for the clear instead, capped so a stuck clear never holds
 * back the fallback.
 */
let clearing: Promise<void> | null = null;
const CLEAR_WAIT_MS = 1000;

/** Esc / F-keys / 1-3 / D / Shift+R / Shift+E. Module level, so useKeyboardShortcuts gets a stable handler. */
export function handleShortcut(s: Shortcut): void {
  switch (s.type) {
    case "mode":
      store.setMode(s.mode);
      break;
    case "decision":
      store.setDecision(!store.getState().decision);
      break;
    case "clear": {
      abortTurn();
      cancelReplay();
      // The aborted turn and replay are now still, so the wave can picture them before the store lets go of them.
      // The wave falls back to a plain clear on its own; this only catches a store that cannot clear.
      const run: Promise<void> = clearThreadWithWave(store.clearThread).catch((err: unknown) =>
        console.error("[esc] could not clear the thread", err),
      );
      clearing = run;
      void run.finally(() => {
        if (clearing === run) clearing = null;
      });
      break;
    }
    case "replay":
      if (clearing) {
        const slot = s.slot;
        void Promise.race([clearing, new Promise<void>((resolve) => setTimeout(resolve, CLEAR_WAIT_MS))]).then(() =>
          playReplay(slot),
        );
      } else {
        playReplay(s.slot);
      }
      break;
    case "save":
      saveLastTurn();
      break;
    case "export":
      void copyReplaysJson();
      break;
  }
}

/** The top bar's "Clear conversation": exactly Esc. */
export function clearConversation(): void {
  handleShortcut({ type: "clear" });
}

/** The Replays menu: exactly the F-key. */
export function playSlot(slot: number): void {
  handleShortcut({ type: "replay", slot });
}

function stopRunning(): void {
  abortTurn();
  cancelReplay();
}

export function switchToSession(id: string): void {
  if (id === store.getState().activeSessionId) return;
  stopRunning();
  store.switchSession(id);
}

export function startNewSession(): void {
  stopRunning();
  store.newSession();
}

/** Deleting another session leaves the open one, and its running turn, alone. */
export function removeSession(id: string): void {
  if (id === store.getState().activeSessionId) stopRunning();
  store.deleteSession(id);
}

export function removeAllSessions(): void {
  stopRunning();
  store.deleteAllSessions();
}
