import { useKeyboardShortcuts } from "@/keyboard";
import { Thread } from "@/panels/Thread";
import { handleShortcut } from "@/shortcuts";
import { useStore } from "@/store";
import { useVoice } from "@/voice/useVoice";
import { HoodPanel } from "./HoodPanel";
import { selectTurn, usePinnedTurnId } from "./selection";
import { SessionRail } from "./SessionRail";
import { TopBar } from "./TopBar";
import { VoiceDock } from "./VoiceDock";

/**
 * Layout A, "Stage": sessions rail | top bar, thread and floating voice dock | under the hood.
 * Fixed columns (narrower below 1440 px), so nothing ever shifts while a screen streams in (U4). The hood is wide
 * enough for its five tabs and the Run view; the middle column keeps a screen's full width down to 1280 px.
 */
export default function StageApp() {
  useKeyboardShortcuts(handleShortcut);
  const voice = useVoice();
  return (
    <div className="grid h-svh grid-cols-[220px_minmax(0,1fr)_340px] overflow-hidden bg-background selection:bg-highlight-soft selection:text-foreground min-[1440px]:grid-cols-[248px_minmax(0,1fr)_380px] min-[1700px]:grid-cols-[248px_minmax(0,1fr)_420px] [&_*]:[scrollbar-color:var(--input)_transparent] [&_*]:[scrollbar-width:thin]">
      <aside aria-label="Sessions" className="min-h-0 min-w-0 border-r bg-panel">
        <SessionRail />
      </aside>
      <main className="relative flex min-h-0 min-w-0 flex-col">
        <TopBar />
        <div className="relative min-h-0 flex-1 [--surface-w:640px] min-[1700px]:[--surface-w:720px]">
          <StageThread />
          {/* Content scrolling under the dock fades out instead of colliding with it. */}
          {/* Solid up to the dock's top edge (22 px gap + 70 px dock), then a short fade. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-[112px] bg-linear-to-t from-background from-[82%] to-transparent" />
        </div>
        <VoiceDock voice={voice} />
      </main>
      <aside aria-label="Under the hood" className="min-h-0 min-w-0 border-l bg-panel">
        <HoodPanel />
      </aside>
    </div>
  );
}

function StageThread() {
  const thread = useStore((s) => s.thread);
  const surfaces = useStore((s) => s.surfaces);
  const newestSurfaceId = useStore((s) => s.newestSurfaceId);
  const decision = useStore((s) => s.decision);
  const replaying = useStore((s) => s.replaying);
  const pinned = usePinnedTurnId();
  return (
    <Thread
      layout="stage"
      foldEarlier
      thread={thread}
      surfaces={surfaces}
      newestSurfaceId={newestSurfaceId}
      decision={decision}
      replaying={replaying}
      selectedTurnId={pinned}
      onSelectTurn={selectTurn}
    />
  );
}
