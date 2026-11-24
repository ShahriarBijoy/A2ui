/**
 * Pure helpers for the read-only data bricks (Table, Chart, Timeline, Rating, Image), so their
 * pending / empty / arrived rules are testable without React.
 */
import type { JsonObject, JsonValue, PathBinding } from "@shared/a2ui";
import { isPathBinding, isPlainObject } from "@shared/a2ui";
import { isIconName, type IconName } from "@shared/icons";
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

/**
 * What an Icon draws. A literal name was validated on arrival. A bound name ({"@path":"icon"} in a List
 * template, or an absolute path) is checked here: a name from the icon set draws, anything else draws
 * nothing; data not arrived yet is "pending" while the turn streams and nothing after it.
 */
export function iconView(name: unknown, data: JsonValue, scope: string, streaming: boolean): IconName | "pending" | null {
  if (!isPathBinding(name)) return isIconName(name) ? name : null;
  let value: JsonValue | undefined;
  try {
    value = getAt(data, resolvePath(name["@path"], scope));
  } catch {
    value = undefined;
  }
  if (value === undefined) return streaming ? "pending" : null;
  return isIconName(value) ? value : null;
}

/** Plot geometry of an area chart in a 0..100 box: x across, y down. */
export type AreaGeometry = {
  /** y labels: max at the top, the midpoint, min at the bottom (one label when every value is the same). */
  ticks: { value: number; y: number }[];
  points: { x: number; y: number }[];
  /** SVG path of the line, and of the area under it down to the bottom edge. */
  line: string;
  area: string;
};

/** Room above the highest and below the lowest point, in box units, so the line never touches an edge. */
const AREA_PAD = 8;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * One scale from the series' own min to its max (not from zero like bars), so a cold day's -4..1 °C still
 * fills the plot. Negative, mixed and flat series are fine; a flat series draws a level line through the middle.
 */
export function areaGeometry(values: readonly number[]): AreaGeometry {
  const n = values.length;
  if (n === 0) return { ticks: [], points: [], line: "", area: "" };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const y = (v: number) => (span === 0 ? 50 : AREA_PAD + ((max - v) / span) * (100 - 2 * AREA_PAD));
  const x = (i: number) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const points = values.map((v, i) => ({ x: r2(x(i)), y: r2(y(v)) }));
  const ticks = span === 0 ? [{ value: min, y: 50 }] : [{ value: max, y: AREA_PAD }, { value: (max + min) / 2, y: 50 }, { value: min, y: 100 - AREA_PAD }];
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const area = `${line} L${points[n - 1].x},100 L${points[0].x},100 Z`;
  return { ticks, points, line, area };
}

/** Indices of the x labels to print: every k-th from the first, at most `max` of them. */
export function thinLabels(n: number, max: number): number[] {
  if (n <= 0 || max <= 0) return [];
  const step = Math.max(1, Math.ceil(n / max));
  const out: number[] = [];
  for (let i = 0; i < n; i += step) out.push(i);
  return out;
}

/** "3°", "40%", "12 km/h": a unit that starts with ° or % sits on the number. */
export function withUnit(text: string, unit: string): string {
  if (!unit) return text;
  return /^[°%]/.test(unit) ? text + unit : `${text} ${unit}`;
}
