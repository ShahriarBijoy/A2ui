/**
 * Number TextField drafts. The field keeps what the person typed ("12.", "-", "1.05") as a local
 * draft while focused and writes a number to the data model only when the draft is a complete number.
 */

export type NumberDraft =
  | { kind: "number"; value: number }
  /** Cleared field: write "" so checks like required() see it as empty. */
  | { kind: "empty" }
  /** On the way to a number ("-", ".", "1e"): keep the draft, write nothing. */
  | { kind: "partial" };

const COMPLETE = /^[+-]?(\d+[.,]?\d*|[.,]\d+)$/;

export function parseNumberDraft(draft: string): NumberDraft {
  const s = draft.trim();
  if (s === "") return { kind: "empty" };
  // A decimal comma is what people type on a German keyboard.
  if (!COMPLETE.test(s)) return { kind: "partial" };
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? { kind: "number", value: n } : { kind: "partial" };
}
