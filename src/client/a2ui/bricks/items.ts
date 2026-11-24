/**
 * Pure helpers for the read-only data bricks (Table, Chart, Timeline, Rating, Image), so their
 * pending / empty / arrived rules are testable without React.
 */
import type { JsonObject, JsonValue, PathBinding } from "@shared/a2ui";
import { isPathBinding, isPlainObject } from "@shared/a2ui";
import { getAt, resolvePath } from "@shared/pointer";

export type ItemsView = { kind: "skeleton" } | { kind: "empty" } | { kind: "items"; items: JsonObject[] };

/**
 * Rows of a Table, bars of a Chart, steps of a Timeline: a literal array, or the array at a path
 * (relative inside a List template). Same rule as List templates (template.ts): data that has not
 * arrived is a skeleton while the turn streams and empty after it, so a mistyped path or a search
 * that found nothing never shimmers forever. Items that are not objects are dropped; null cells stay.
 */
export function resolveItems(binding: PathBinding | JsonValue[], data: JsonValue, scope: string, streaming: boolean): ItemsView {
  let value: JsonValue | undefined;
  if (isPathBinding(binding)) {
    try {
      value = getAt(data, resolvePath(binding["@path"], scope));
    } catch {
      value = undefined;
    }
    if (value === undefined) return streaming ? { kind: "skeleton" } : { kind: "empty" };
  } else {
    value = binding;
  }
  if (!Array.isArray(value)) return { kind: "empty" };
  const items = value.filter((x): x is JsonObject => isPlainObject(x));
  return items.length > 0 ? { kind: "items", items } : { kind: "empty" };
}

const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
/** "4.5/5", "4,6 / 5", "4.3 out of 5", optionally "stars" and one bracketed note: "4.5/5 (1,203 reviews)". */
const SCALED = new RegExp(`^${NUM}\\s*(?:/|out of)\\s*${NUM}\\s*(?:stars?)?\\s*(?:\\([^)]*\\))?$`, "i");
/** "4.4", "4.4 stars", "4.4★". */
const BARE = new RegExp(`^${NUM}\\s*(?:stars?|★)?$`, "i");

const toNum = (s: string) => Number(s.replace(",", "."));

/**
 * A rating as a data line wrote it: 4.2, "4.5/5", "8.7/10". The scale comes from the value when it
 * states one, else from `max` (default 5). Anything else, a negative value or one above its scale
 * is no rating: the brick then shows nothing (a number nobody stated is never drawn).
 */
export function parseRating(v: JsonValue | undefined, max?: number): { value: number; max: number } | null {
  const fallbackMax = typeof max === "number" && Number.isFinite(max) && max > 0 ? max : 5;
  let value: number;
  let scale = fallbackMax;
  if (typeof v === "number") {
    value = v;
  } else if (typeof v === "string") {
    const s = v.trim();
    const scaled = SCALED.exec(s);
    const bare = scaled ? null : BARE.exec(s);
    if (scaled) {
      value = toNum(scaled[1]);
      scale = toNum(scaled[2]);
    } else if (bare) {
      value = toNum(bare[1]);
    } else {
      return null;
    }
  } else {
    return null;
  }
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0 || value < 0 || value > scale) return null;
  return { value, max: scale };
}

/** Bar lengths in percent of the largest value; negatives count as 0; all zero → all 0. */
export function barWidths(values: readonly number[]): number[] {
  const top = Math.max(0, ...values.map((v) => (Number.isFinite(v) ? v : 0)));
  if (top <= 0) return values.map(() => 0);
  return values.map((v) => (Number.isFinite(v) && v > 0 ? (v / top) * 100 : 0));
}

const AMOUNT = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
/** A number as the bricks print it: grouped, at most two decimals. */
export function formatAmount(n: number): string {
  return AMOUNT.format(n);
}

/** Text for a table cell or label: strings as written, numbers formatted, a list joined, null blank. */
export function cellText(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? formatAmount(v) : "";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(cellText).filter(Boolean).join(", ");
  return "";
}

/** True for an absolute http(s) URL; anything else (data:, javascript:, relative) is never loaded. */
export function isHttpUrl(s: string): boolean {
  try {
    const u = new URL(s);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export type ImageLoad = "loading" | "loaded" | "failed";

/**
 * What the Image brick draws. No usable url (null, empty, not http(s)): nothing at all, streaming or
 * not, so a record without a photo never shows a box that later collapses. Once a url exists the box
 * appears at its fixed aspect with a skeleton until the picture loads (the one growth, when a real
 * photo arrives). A url that fails to load hides the brick: no broken-image icon.
 */
export function imageView(url: string, load: ImageLoad): "skeleton" | "image" | "hidden" {
  if (!isHttpUrl(url) || load === "failed") return "hidden";
  return load === "loaded" ? "image" : "skeleton";
}
