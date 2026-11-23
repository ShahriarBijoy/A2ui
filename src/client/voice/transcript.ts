/**
 * Pure token → transcript assembly. No SDK or DOM imports so it stays trivially testable.
 */

export type TokenLike = { text: string; is_final: boolean };
export type TranscriptView = { final: string; interim: string };

/** Control tokens (<fin>, <end>) mark protocol events, never speech. */
const CONTROL_TOKEN = /^<[a-z_]+>$/;

export function isControlToken(text: string): boolean {
  return CONTROL_TOKEN.test(text);
}

const SHORT_ANSWERS = new Set(["yes", "no", "ok", "ja", "nein", "nö", "yep", "nope"]);

/** Guards against fragments ("I'", "uh") becoming turns while short real answers ("yes", "6") still pass. */
export function isMeaningfulUtterance(text: string): boolean {
  const words = text
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w !== "" && !isControlToken(w));
  if (words.length === 0) return false;
  if (words.length > 1) return true;
  const w = words[0]!;
  return /^\d+$/.test(w) || SHORT_ANSWERS.has(w) || w.length > 2;
}

/** Injected so tests can run a fake clock. */
export type Timers = { set: (fn: () => void, ms: number) => unknown; clear: (handle: unknown) => void };
export const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Soniox sends each final token exactly once, but re-sends the whole current non-final tail on every result.
 * So finals are appended and the interim tail is replaced.
 */
export class TranscriptAssembler {
  private finals = "";
  private interim = "";

  feed(tokens: readonly TokenLike[]): TranscriptView {
    let tail = "";
    for (const t of tokens) {
      if (isControlToken(t.text)) continue;
      if (t.is_final) this.finals += t.text;
      else tail += t.text;
    }
    // A result with only final tokens must not wipe an interim tail that the next result will re-send anyway,
    // but finals always supersede the old tail: the server never repeats a finalized word as non-final.
    this.interim = tail;
    return this.view();
  }

  view(): TranscriptView {
    const final = this.finals.trimStart();
    // Tokens carry their own leading space, so only the very first piece needs trimming.
    const interim = final === "" ? this.interim.trimStart() : this.interim;
    return { final, interim };
  }

  /** Everything heard so far, final and interim, as one string. */
  fullText(): string {
    const { final, interim } = this.view();
    return (final + interim).replace(/\s+/g, " ").trim();
  }

  finalText(): string {
    return this.finals.replace(/\s+/g, " ").trim();
  }

  /** Hands-free: returns the finished utterance and starts the next one. */
  takeFinal(): string {
    const text = this.finalText();
    this.finals = "";
    this.interim = "";
    return text;
  }

  reset(): void {
    this.finals = "";
    this.interim = "";
  }
}
