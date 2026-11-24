import { EraserIcon, MessageSquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ICONS } from "@/iconMap";
import { clearConversation } from "@/shortcuts";
import type { AppState } from "@/state";
import { useStore } from "@/store";
import { ReplayMenu } from "./ReplayMenu";
import { STAGE_BUTTON } from "./styles";

/** The composer model of the open session's newest composed turn, as its turn chip shows it; null before one. */
function composerModel(s: AppState): string | null {
  for (let i = s.thread.length - 1; i >= 0; i--) {
    const item = s.thread[i];
    if (item.kind === "agent" && item.metrics.usage) return item.metrics.usage.model;
  }
  return null;
}

export function TopBar() {
  const title = useStore((s) => s.sessions.find((m) => m.id === s.activeSessionId)?.title ?? "New session");
  const icon = useStore((s) => s.sessions.find((m) => m.id === s.activeSessionId)?.icon ?? null);
  const mode = useStore((s) => s.mode);
  const decision = useStore((s) => s.decision);
  const model = useStore(composerModel);
  const empty = useStore((s) => s.thread.length === 0);
  const Icon = icon ? ICONS[icon] : MessageSquareIcon;
  // Only what was measured: the model appears once a turn has reported it.
  const line = model ? `${mode} · ${model} composes` : `${mode} · decision model ${decision ? "on" : "off"}`;
  return (
    <header className="bb-chrome flex h-16 shrink-0 items-center justify-between gap-4 border-b px-7">
      <div className="min-w-0">
        <h1 className="flex min-w-0 items-center gap-2 text-[1rem] leading-tight font-semibold tracking-tight">
          <Icon aria-hidden className="size-[18px] shrink-0 text-highlight-ink" />
          <span className="truncate" title={title}>
            {title}
          </span>
        </h1>
        <p className="mt-0.5 truncate font-mono text-[0.75rem] text-muted-foreground">{line}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <ReplayMenu />
        <Button variant="outline" className={STAGE_BUTTON} onClick={clearConversation} disabled={empty} title="Clear conversation (Esc)">
          <EraserIcon aria-hidden />
          Clear conversation
        </Button>
      </div>
    </header>
  );
}
