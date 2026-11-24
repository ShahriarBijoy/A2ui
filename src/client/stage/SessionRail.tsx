import { useState } from "react";
import { EllipsisIcon, MessageSquareIcon, SquarePenIcon, Trash2Icon } from "lucide-react";
import { MODES, type Mode } from "@shared/protocol";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { ICONS } from "@/iconMap";
import { MODE_KEYS } from "@/keyboard";
import { cn } from "@/lib/utils";
import { removeAllSessions, removeSession, startNewSession, switchToSession } from "@/shortcuts";
import type { SessionMeta } from "@/state";
import { store, useStore } from "@/store";
import { STAGE_LABEL } from "./styles";

type Confirm = { kind: "all"; count: number } | { kind: "one"; id: string; title: string } | null;

const CLOCK = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function sessionLine(m: SessionMeta): string {
  const turns = m.turns === 0 ? "Empty" : m.turns === 1 ? "1 turn" : `${m.turns} turns`;
  return `${turns} · ${CLOCK.format(m.updatedAt)}`;
}

/** Left rail: brand, New session, the sessions saved in this browser, and the answer settings. */
export function SessionRail() {
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeSessionId);
  const openEmpty = useStore((s) => s.thread.length === 0);
  // The confirm's content stays set while it animates closed, so its words never flip; `open` drives visibility.
  const [confirm, setConfirmContent] = useState<Confirm>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const setConfirm = (next: Confirm) => {
    if (next) setConfirmContent(next);
    setConfirmOpen(next !== null);
  };
  const saved = sessions.filter((m) => m.turns > 0).length;

  const onConfirm = () => {
    if (confirm?.kind === "all") removeAllSessions();
    else if (confirm?.kind === "one") removeSession(confirm.id);
    setConfirm(null);
  };

  return (
    <div className="bb-chrome flex h-full min-h-0 flex-col gap-[18px] px-4 pt-[22px] pb-[18px]">
      <Brand />
      <Button
        onClick={startNewSession}
        // Not disabled when the open session is empty: it already is a new session, so the click has nothing to do,
        // and a greyed-out main button would read as broken on the projector.
        className="h-10 w-full gap-2 rounded-[11px] text-[0.875rem] font-semibold"
        title={openEmpty ? "This session is already new" : "Start an empty session; this one stays in the list"}
      >
        <SquarePenIcon aria-hidden />
        New session
      </Button>

      <div className="flex min-h-0 flex-1 flex-col gap-1.5">
        <div className="flex h-7 items-center justify-between pl-1">
          <h2 className={STAGE_LABEL}>Sessions</h2>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Session options"
                  className="text-muted-foreground hover:bg-foreground/[0.06]"
                />
              }
            >
              <EllipsisIcon aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bb-chrome min-w-52">
              <DropdownMenuItem
                variant="destructive"
                disabled={saved === 0}
                onClick={() => setConfirm({ kind: "all", count: saved })}
              >
                <Trash2Icon aria-hidden />
                Delete all sessions
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <ul className="-mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1 pb-1">
          {sessions.map((m) => (
            <SessionRow
              key={m.id}
              meta={m}
              active={m.id === activeId}
              onDelete={() => setConfirm({ kind: "one", id: m.id, title: m.title })}
            />
          ))}
        </ul>
      </div>

      <RailSettings />

      <AlertDialog open={confirmOpen} onOpenChange={(open: boolean) => !open && setConfirm(null)}>
        <AlertDialogContent className="bb-chrome">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "all"
                ? `Delete all ${confirm.count} ${confirm.count === 1 ? "session" : "sessions"}?`
                : "Delete this session?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.kind === "one" ? <>“{confirm.title}” and its screens leave this browser. </> : null}
              This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onConfirm}>
              {confirm?.kind === "all" ? "Delete all" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="grid size-[34px] shrink-0 place-items-center rounded-[10px] bg-primary text-primary-foreground">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
          aria-hidden="true"
          className="size-5"
        >
          <rect x="3" y="13" width="8" height="7" rx="1.5" />
          <rect x="13" y="13" width="8" height="7" rx="1.5" />
          <rect x="8" y="4" width="8" height="7" rx="1.5" fill="currentColor" />
        </svg>
      </div>
      <div className="min-w-0">
        <p className="text-[1.0625rem] leading-tight font-semibold tracking-[-0.01em]">Brick Box</p>
        <p className="truncate text-[0.75rem] text-muted-foreground">Built from a box of bricks</p>
      </div>
    </div>
  );
}

function SessionRow({ meta, active, onDelete }: { meta: SessionMeta; active: boolean; onDelete: () => void }) {
  const Icon = meta.icon ? ICONS[meta.icon] : MessageSquareIcon;
  return (
    <li className="group/row relative">
      <button
        type="button"
        onClick={() => switchToSession(meta.id)}
        aria-current={active ? "true" : undefined}
        className={cn(
          "grid w-full grid-cols-[30px_minmax(0,1fr)] items-center gap-2.5 rounded-[11px] py-[9px] pr-2.5 pl-2.5 text-left outline-none",
          "transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
          active
            ? "bg-card text-foreground shadow-[0_1px_0_var(--border)]"
            : "text-panel-foreground hover:bg-card/55",
        )}
      >
        <span
          className={cn(
            "grid size-[30px] place-items-center rounded-[9px]",
            active ? "bg-highlight-soft/60 text-highlight-ink" : "bg-foreground/[0.06]",
          )}
        >
          <Icon aria-hidden className="size-4" />
        </span>
        {/* Room for the delete button only while it shows: the row keeps its size, only the ellipsis moves. */}
        <span className="min-w-0 group-focus-within/row:pr-7 group-hover/row:pr-7">
          <span className="block truncate text-[0.875rem] leading-snug font-medium" title={meta.title}>
            {meta.title}
          </span>
          <span className="block truncate text-[0.75rem] text-muted-foreground">{sessionLine(meta)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete session: ${meta.title}`}
        className={cn(
          "absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-[8px] text-muted-foreground outline-none",
          "opacity-0 transition-opacity duration-150 group-hover/row:opacity-100 hover:bg-background hover:text-destructive",
          "focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none",
        )}
      >
        <Trash2Icon aria-hidden className="size-4" />
      </button>
    </li>
  );
}

const MODE_ITEMS: readonly { mode: Mode; label: string }[] = [
  { mode: "widgets", label: "Widgets" },
  { mode: "html", label: "HTML" },
  { mode: "a2ui", label: "A2UI" },
];

function RailSettings() {
  const mode = useStore((s) => s.mode);
  const decision = useStore((s) => s.decision);
  const handsFree = useStore((s) => s.handsFree);
  return (
    <div className="flex flex-col gap-2.5">
      <h2 className={cn(STAGE_LABEL, "pl-1")}>Answer with</h2>
      <ToggleGroup
        aria-label="Answer mode"
        value={[mode]}
        onValueChange={(v: string[]) => {
          // Pressing the active segment would leave no mode; keep the current one.
          const next = MODES.find((m) => m === v[0]);
          if (next) store.setMode(next);
        }}
        spacing={1}
        className="grid w-full grid-cols-3 gap-0 rounded-[10px] bg-foreground/[0.07] p-[3px]"
      >
        {MODE_ITEMS.map((m) => (
          <ToggleGroupItem
            key={m.mode}
            value={m.mode}
            aria-label={`${m.label} mode (key ${MODE_KEYS[m.mode]})`}
            // px, not rem: the rail is a fixed 248 / 220 px, so its segments must not grow with the 18 px stage root.
            className="h-[30px] min-w-0 gap-1.5 rounded-[8px] px-1 text-[13px] text-panel-foreground hover:bg-card/60 aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary motion-reduce:transition-none"
          >
            {m.label}
            <kbd className="hidden font-mono text-[10px] opacity-60 min-[1440px]:inline">{MODE_KEYS[m.mode]}</kbd>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <SettingSwitch label="Decision model" hint="D" checked={decision} onChange={store.setDecision} />
      <SettingSwitch label="Hands-free" checked={handsFree} onChange={store.setHandsFree} />
    </div>
  );
}

function SettingSwitch({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-2 px-1 py-0.5 text-[0.8125rem] font-medium text-panel-foreground select-none">
      <span className="flex items-center gap-2">
        {label}
        {hint && <Kbd className="h-[18px] border border-input bg-transparent font-mono text-[0.625rem]">{hint}</Kbd>}
      </span>
      <Switch checked={checked} onCheckedChange={(c: boolean) => onChange(c)} />
    </label>
  );
}
