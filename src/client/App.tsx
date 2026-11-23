import { lazy, Suspense } from "react";
import { ChevronRightIcon } from "lucide-react";
import { useKeyboardShortcuts, type Shortcut } from "@/keyboard";
import { clearThreadWithWave } from "@/fx/waveControl";
import { glowPhase } from "@/fx/voiceSweep";
import { BottomBar, type VoiceStatus } from "@/panels/BottomBar";
import { BrickPool } from "@/panels/BrickPool";
import { Inspector } from "@/panels/Inspector";
import { Thread } from "@/panels/Thread";
import { cancelReplay, copyReplaysJson, playReplay, saveLastTurn, useReplayNote } from "@/replay";
import { store, useStore } from "@/store";
import { abortTurn, sendTurn } from "@/turns";
import { useVoice } from "@/voice/useVoice";

// Dev-only: the fixture runner never loads on the stage URL.
const DEV = new URLSearchParams(window.location.search).has("dev");
const DevRunner = lazy(() => import("@/a2ui/DevRunner"));

/**
 * The Esc clear while it runs. The wave keeps the thread when a turn begins mid-clear (a live turn's newer intent
 * wins), so a replay key pressed right after Esc waits for the clear instead, capped so a stuck clear never holds
 * back the fallback.
 */
let clearing: Promise<void> | null = null;
const CLEAR_WAIT_MS = 1000;

function onShortcut(s: Shortcut): void {
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

function sendText(text: string): void {
  sendTurn({ input: { type: "utterance", text }, display: text, via: "text" });
}

/** The stage: pool | thread | inspector over a full-width bottom bar. Fixed columns, so nothing ever shifts (U4). */
export default function App() {
  useKeyboardShortcuts(onShortcut);
  const voice = useVoice();
  return (
    <div className="grid h-svh grid-cols-[15rem_minmax(0,1fr)_24rem] grid-rows-[minmax(0,1fr)_auto] overflow-hidden selection:bg-highlight-soft selection:text-foreground [&_*]:[scrollbar-color:var(--input)_transparent] [&_*]:[scrollbar-width:thin]">
      <aside className="min-h-0 border-r">
        <PoolPanel />
      </aside>
      <main className="min-h-0 min-w-0">
        <ThreadPanel />
      </main>
      <aside className="min-h-0 min-w-0 border-l">
        <InspectorPanel />
      </aside>
      <div className="col-span-3 min-w-0">
        {DEV && <DevStrip />}
        <BottomBarPanel voice={voice} />
      </div>
    </div>
  );
}

function PoolPanel() {
  const pool = useStore((s) => s.pool);
  return <BrickPool pool={pool} />;
}

function ThreadPanel() {
  const thread = useStore((s) => s.thread);
  const surfaces = useStore((s) => s.surfaces);
  const newestSurfaceId = useStore((s) => s.newestSurfaceId);
  const decision = useStore((s) => s.decision);
  const replaying = useStore((s) => s.replaying);
  return (
    <Thread
      thread={thread}
      surfaces={surfaces}
      newestSurfaceId={newestSurfaceId}
      decision={decision}
      replaying={replaying}
    />
  );
}

function InspectorPanel() {
  const wire = useStore((s) => s.wire);
  const surface = useStore((s) => (s.newestSurfaceId ? (s.surfaces[s.newestSurfaceId] ?? null) : null));
  return <Inspector wire={wire} surface={surface} />;
}

function BottomBarPanel({ voice }: { voice: VoiceStatus }) {
  const transcript = useStore((s) => s.transcript);
  const mode = useStore((s) => s.mode);
  const decision = useStore((s) => s.decision);
  const handsFree = useStore((s) => s.handsFree);
  const totals = useStore((s) => s.totals);
  const glow = useStore(glowPhase);
  const replayNote = useReplayNote();
  return (
    <BottomBar
      transcript={transcript}
      voice={voice}
      mode={mode}
      decision={decision}
      handsFree={handsFree}
      totals={totals}
      glow={glow}
      replayNote={replayNote}
      onMode={store.setMode}
      onDecision={store.setDecision}
      onHandsFree={store.setHandsFree}
      onSend={sendText}
    />
  );
}

function DevStrip() {
  return (
    <details className="group border-t bg-card/40">
      <summary className="cursor-pointer list-none px-5 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.14em] text-muted-foreground select-none hover:text-foreground">
        <span className="inline-flex items-center gap-1">
          <ChevronRightIcon aria-hidden className="size-3.5 group-open:rotate-90" />
          Dev runner
        </span>
      </summary>
      <div className="max-h-[40vh] overflow-y-auto border-t px-5 py-3">
        <Suspense fallback={<p className="font-mono text-[0.75rem] text-muted-foreground">Loading…</p>}>
          <DevRunner />
        </Suspense>
      </div>
    </details>
  );
}
