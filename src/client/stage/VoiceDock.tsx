import { useRef, useState, type FormEvent, type PointerEvent } from "react";
import { KeyboardIcon, MicIcon, MicOffIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { tailText } from "@/format";
import { VoiceGlow } from "@/fx/VoiceGlow";
import { glowPhase } from "@/fx/voiceSweep";
import { cn } from "@/lib/utils";
import type { VoiceStatus } from "@/panels/BottomBar";
import { useReplayNote } from "@/replay";
import type { Transcript } from "@/state";
import { useStore } from "@/store";
import { sendTurn } from "@/turns";

function sendText(text: string): void {
  sendTurn({ input: { type: "utterance", text }, display: text, via: "text" });
}

/**
 * The floating voice dock: mic, what it hears, and the typed fallback, in one dark pill at the bottom of the
 * main column. The glow (the live microphone, then the processing sweep) rises inside it.
 */
export function VoiceDock({ voice }: { voice: VoiceStatus }) {
  const transcript = useStore((s) => s.transcript);
  const handsFree = useStore((s) => s.handsFree);
  const glow = useStore(glowPhase);
  const note = useReplayNote();
  const listening = transcript.listening || voice.listening;
  const blocked = Boolean(transcript.error ?? voice.error) && !listening;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-[22px] z-10 flex justify-center px-6">
      <VoiceGlow phase={glow} theme="dark" className="bb-chrome pointer-events-auto w-full max-w-[720px] rounded-[20px]">
        <div className="flex h-[70px] items-center gap-3.5 rounded-[20px] bg-primary pr-3.5 pl-3 text-primary-foreground">
          <MicButton listening={listening} available={voice.supported} blocked={blocked} handsFree={handsFree} />
          <DockStatus transcript={transcript} voice={voice} handsFree={handsFree} note={note} />
          <TypeField />
        </div>
      </VoiceGlow>
    </div>
  );
}

/**
 * Hold to talk with the mouse: the same push-to-talk as Space. It hands untargeted Space key events to the voice
 * lane's window listeners, exactly as the Space shield in keyboard.ts does for a focused control.
 */
function MicButton({
  listening,
  available,
  blocked,
  handsFree,
}: {
  listening: boolean;
  available: boolean;
  /** Voice reported an error (mic blocked, no key…): look unarmed. Holding still retries, like Space. */
  blocked: boolean;
  handsFree: boolean;
}) {
  const held = useRef(false);
  const press = (type: "keydown" | "keyup") =>
    window.dispatchEvent(new KeyboardEvent(type, { key: " ", code: "Space", bubbles: true, cancelable: true }));
  const down = (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 || held.current || !available || handsFree) return;
    held.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    press("keydown");
  };
  const up = () => {
    if (!held.current) return;
    held.current = false;
    press("keyup");
  };
  const Icon = available && !blocked ? MicIcon : MicOffIcon;
  return (
    <button
      type="button"
      aria-label={handsFree ? "Microphone (hands-free)" : "Hold to talk"}
      aria-pressed={listening}
      aria-disabled={!available || handsFree}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onContextMenu={(e) => e.preventDefault()}
      className={cn(
        "grid size-[46px] shrink-0 touch-none place-items-center rounded-full text-white outline-none select-none",
        "shadow-[0_0_0_6px_color-mix(in_srgb,var(--highlight)_22%,transparent)] transition-[background-color,box-shadow] duration-150",
        "focus-visible:ring-3 focus-visible:ring-primary-foreground/70 motion-reduce:transition-none",
        available && !blocked ? "bg-highlight" : "bg-primary-foreground/15 text-primary-foreground/80 shadow-none",
        listening && "bb-mic-live",
      )}
    >
      <Icon aria-hidden className="size-[21px]" />
    </button>
  );
}

function DockStatus({
  transcript,
  voice,
  handsFree,
  note,
}: {
  transcript: Transcript;
  voice: VoiceStatus;
  handsFree: boolean;
  note: string | null;
}) {
  const listening = transcript.listening || voice.listening;
  const error = transcript.error ?? voice.error;
  const heard = transcript.final + (transcript.final && transcript.interim ? " " : "") + transcript.interim;

  let main;
  let sub: string;
  if (error && !listening) {
    // Two lines for the whole instruction ("… Allow it in the address bar."), no small line under it.
    return (
      <div className="flex min-w-0 flex-1 flex-col justify-center" aria-live="polite">
        <span className="sr-only">Microphone off</span>
        <p className="line-clamp-2 text-[0.8125rem] leading-snug font-semibold text-[#f4a68b]" title={error}>
          {error}
        </p>
      </div>
    );
  } else if (heard) {
    // Keep the newest words in view: an rtl box with an ltr isolate overflows to the left.
    const finalShown = tailText(transcript.final, 300);
    const interimShown = tailText(transcript.interim, Math.max(20, 300 - finalShown.length));
    main = (
      <span dir="rtl" className={cn("block truncate text-left", !listening && "text-primary-foreground/70")}>
        <span dir="ltr" className="[unicode-bidi:isolate]">
          <span>{finalShown}</span>
          {transcript.interim && (
            <span className="text-primary-foreground/55">
              {transcript.final ? " " : ""}
              {interimShown}
            </span>
          )}
        </span>
      </span>
    );
    sub = listening ? (handsFree ? "Hands-free · listening" : "Release Space to send") : "Heard";
  } else if (listening) {
    main = <span>Listening…</span>;
    sub = handsFree ? "Hands-free · just talk" : "Release Space to send";
  } else if (!voice.supported) {
    main = <span>Voice is off</span>;
    sub = "Type a request instead";
  } else if (handsFree) {
    main = <span>Hands-free: just talk</span>;
    sub = "Listening for your voice";
  } else {
    main = (
      <span className="flex items-center gap-1.5">
        Hold
        <kbd className="rounded-[5px] border border-primary-foreground/25 px-1.5 font-mono text-[0.6875rem] leading-[1.35rem] tracking-wide">
          SPACE
        </kbd>
        to talk
      </span>
    );
    sub = "Release to send";
  }
  // Replay feedback ("Replaying F2 · …", "Saved to F3 · …") takes the small line while nothing more urgent does.
  if (note && !listening && !error) sub = note;

  return (
    <div className="flex min-w-0 flex-1 flex-col justify-center leading-tight" aria-live="polite">
      <span className="sr-only">{listening ? "Microphone on" : "Microphone off"}</span>
      <div className="min-w-0 truncate text-[0.9375rem] font-semibold">{main}</div>
      <div className="min-w-0 truncate pt-0.5 text-[0.75rem] text-primary-foreground/60" title={sub}>
        {sub}
      </div>
    </div>
  );
}

function TypeField() {
  const [text, setText] = useState("");
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    sendText(t);
    setText("");
    // Space after a typed request should talk, not type a space into the field.
    const active = document.activeElement;
    if (active instanceof HTMLElement && e.currentTarget.contains(active)) active.blur();
  };
  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex h-10 w-[300px] shrink items-center gap-2 rounded-xl bg-primary-foreground/[0.09] pl-3 text-primary-foreground/60",
        "transition-[box-shadow] duration-150 focus-within:ring-2 focus-within:ring-highlight/70 motion-reduce:transition-none",
        "min-w-[11rem]",
      )}
    >
      <KeyboardIcon aria-hidden className="size-4 shrink-0" />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Or type a request"
        aria-label="Type a request"
        maxLength={400}
        className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-0 pr-3 text-[0.8125rem] text-primary-foreground shadow-none placeholder:text-primary-foreground/50 focus-visible:ring-0 md:text-[0.8125rem] dark:bg-transparent"
      />
    </form>
  );
}
