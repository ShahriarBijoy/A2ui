import { useState, type FormEvent } from "react";
import { MODES, type Mode } from "@shared/protocol";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatTokens, tailText } from "@/format";
import { MODE_KEYS } from "@/keyboard";
import { cn } from "@/lib/utils";
import type { SessionTotals, Transcript } from "@/state";

/** What useVoice() reports (voice lane). */
export type VoiceStatus = { supported: boolean; ready: boolean; listening: boolean; error?: string };

type Props = {
  transcript: Transcript;
  voice: VoiceStatus | null;
  mode: Mode;
  decision: boolean;
  handsFree: boolean;
  totals: SessionTotals;
  onMode: (mode: Mode) => void;
  onDecision: (on: boolean) => void;
  onHandsFree: (on: boolean) => void;
  onSend: (text: string) => void;
};

const MODE_ITEMS: readonly { mode: Mode; label: string }[] = [
  { mode: "widgets", label: "Widgets" },
  { mode: "html", label: "HTML" },
  { mode: "a2ui", label: "A2UI" },
];

export function BottomBar(props: Props) {
  const { transcript, voice, mode, decision, handsFree, totals } = props;
  return (
    <footer className="grid h-[6.25rem] shrink-0 grid-rows-2 gap-y-1 border-t bg-card/60 px-5 py-2">
      <div className="flex min-w-0 items-center gap-6">
        <TranscriptLine transcript={transcript} voice={voice} handsFree={handsFree} />
        <Totals totals={totals} />
      </div>
      <div className="flex min-w-0 items-center gap-5">
        <TextFallback onSend={props.onSend} />
        <ToggleGroup
          aria-label="Answer mode"
          value={[mode]}
          onValueChange={(v: string[]) => {
            // Pressing the active segment would leave no mode; keep the current one.
            const next = MODES.find((m) => m === v[0]);
            if (next) props.onMode(next);
          }}
          variant="outline"
          spacing={0}
          className="shrink-0 bg-background"
        >
          {MODE_ITEMS.map((m) => (
            <ToggleGroupItem
              key={m.mode}
              value={m.mode}
              aria-label={`${m.label} mode (key ${MODE_KEYS[m.mode]})`}
              className="h-9 gap-2 px-3.5 text-[0.875rem] motion-reduce:transition-none aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary"
            >
              {m.label}
              <Kbd className="bg-transparent font-mono text-[0.6875rem] text-current opacity-60">{MODE_KEYS[m.mode]}</Kbd>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Toggle label="Decision model" hint="D" checked={decision} onChange={props.onDecision} />
        <Toggle label="Hands-free" checked={handsFree} onChange={props.onHandsFree} />
      </div>
    </footer>
  );
}

function TranscriptLine({ transcript, voice, handsFree }: { transcript: Transcript; voice: VoiceStatus | null; handsFree: boolean }) {
  const listening = transcript.listening || Boolean(voice?.listening);
  const error = transcript.error ?? voice?.error;
  const heard = transcript.final + (transcript.final && transcript.interim ? " " : "") + transcript.interim;
  const unavailable = voice !== null && !voice.supported;
  const dot = error
    ? "bg-destructive"
    : listening
      ? "bg-highlight motion-safe:animate-pulse"
      : voice?.ready
        ? "bg-foreground/45"
        : "border border-input bg-transparent";

  let line;
  if (error && !listening) {
    line = <span className="truncate text-destructive">{error}</span>;
  } else if (heard) {
    // Keep the newest words in view; the line never wraps, so the bar never grows.
    const max = 400;
    const finalShown = tailText(transcript.final, max);
    const interimShown = tailText(transcript.interim, Math.max(20, max - finalShown.length));
    // rtl box + ltr isolate: short text sits left, long text overflows to the left, so the newest words stay visible.
    line = (
      <span dir="rtl" className={cn("min-w-0 flex-1 truncate text-left", !listening && "text-muted-foreground")}>
        <span dir="ltr" className="[unicode-bidi:isolate]">
          <span>{finalShown}</span>
          {transcript.interim && (
            <span className="text-muted-foreground/70">
              {transcript.final ? " " : ""}
              {interimShown}
            </span>
          )}
        </span>
      </span>
    );
  } else if (listening) {
    line = <span className="text-muted-foreground">Listening…</span>;
  } else if (unavailable || voice === null) {
    line = <span className="text-muted-foreground">Voice is off. Type a request below.</span>;
  } else if (handsFree) {
    line = <span className="text-muted-foreground">Hands-free: just talk.</span>;
  } else {
    line = (
      <span className="flex items-center gap-2 text-muted-foreground">
        Hold <Kbd className="h-6 border border-input bg-background px-2 font-mono text-[0.75rem] text-foreground">SPACE</Kbd>{" "}
        to talk
      </span>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-3 text-[1.0625rem]" aria-live="polite">
      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", dot)} />
      <span className="sr-only">{listening ? "Microphone on" : "Microphone off"}</span>
      {line}
    </div>
  );
}

function Totals({ totals }: { totals: SessionTotals }) {
  return (
    <dl className="flex shrink-0 items-end gap-6">
      <Stat label="Turns" value={String(totals.turns)} />
      <Stat label="LLM calls avoided" value={String(totals.llmAvoided)} mark={totals.llmAvoided > 0} />
      <Stat
        label="Tokens in / out"
        value={`${formatTokens(totals.inputTokens)} / ${formatTokens(totals.outputTokens)}`}
      />
    </dl>
  );
}

function Stat({ label, value, mark }: { label: string; value: string; mark?: boolean }) {
  return (
    <div className="flex flex-col items-end gap-0.5">
      <dt className="flex items-center gap-1.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-muted-foreground">
        {mark && <span aria-hidden className="size-1.5 rounded-full bg-highlight" />}
        {label}
      </dt>
      <dd className="font-mono text-[1.25rem] font-medium leading-none tabular-nums">{value}</dd>
    </div>
  );
}

function TextFallback({ onSend }: { onSend: (text: string) => void }) {
  const [text, setText] = useState("");
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setText("");
  };
  return (
    <form onSubmit={submit} className="flex min-w-0 flex-1 items-center gap-2">
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Or type a request and press Enter"
        aria-label="Type a request"
        maxLength={400}
        className="h-9 min-w-0 flex-1 bg-background text-[0.9375rem] md:text-[0.9375rem]"
      />
    </form>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="flex shrink-0 cursor-pointer items-center gap-2.5 text-[0.875rem] select-none">
      <Switch checked={checked} onCheckedChange={(c: boolean) => onChange(c)} />
      <span>{label}</span>
      {hint && <Kbd className="border border-input bg-transparent font-mono text-[0.6875rem]">{hint}</Kbd>}
    </label>
  );
}
