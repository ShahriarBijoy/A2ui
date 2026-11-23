/**
 * Dynamic values, functions and checks for the brick-box/v1 catalog (A2UI v1.0).
 * Pure: no React, no store. Bricks call these on every render, so nothing here mutates.
 */
import type { Action, CheckRule, DynamicValue, JsonObject, JsonValue } from "@shared/a2ui";
import { isFunctionCall, isPathBinding, isPlainObject } from "@shared/a2ui";
import { isFunctionName, type FunctionName } from "@shared/catalog";
import { getAt, resolvePath } from "@shared/pointer";

/** scope = absolute pointer of the current List template item, "/" at top level. */
export type EvalContext = { data: JsonValue; scope: string };

export class EvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalError";
  }
}

type Args = { [arg: string]: JsonValue | undefined };
type Fn = (args: Args, ctx: EvalContext) => JsonValue;

export function resolve(value: DynamicValue | undefined, ctx: EvalContext): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => resolve(v, ctx) ?? null);
  if (isPathBinding(value)) return readPath(value["@path"], ctx);
  if (isFunctionCall(value)) return callFunction(value["@call"], value.args, ctx);
  const out: JsonObject = {};
  for (const [key, v] of Object.entries(value)) {
    const r = resolve(v, ctx);
    if (r !== undefined) out[key] = r;
  }
  return out;
}

/** Absolute pointer a binding writes to, or null when the value is not a plain @path binding. */
export function boundPath(value: unknown, scope: string): string | null {
  if (!isPathBinding(value)) return null;
  return resolvePath(value["@path"], scope);
}

function readPath(path: string, ctx: EvalContext): JsonValue | undefined {
  try {
    return getAt(ctx.data, resolvePath(path, ctx.scope));
  } catch {
    // A malformed pointer reads as "no value"; the processor already accepted the component.
    return undefined;
  }
}

function callFunction(name: string, rawArgs: FunctionCallArgs, ctx: EvalContext): JsonValue {
  if (!isFunctionName(name)) throw new EvalError("Unknown function " + JSON.stringify(name));
  const args: Args = {};
  if (isPlainObject(rawArgs)) {
    for (const [key, v] of Object.entries(rawArgs)) args[key] = resolve(v, ctx);
  }
  return FUNCTIONS[name](args, ctx);
}
type FunctionCallArgs = { [arg: string]: DynamicValue } | undefined;

// ── Coercions: never throw on a type mismatch ────────────────────────────────

export function toText(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map(toText).join(", ");
  return JSON.stringify(v);
}

export function toNumber(v: JsonValue | undefined): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

export function toBool(v: JsonValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") return v !== "" && v !== "false";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function isPresent(v: JsonValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

export function resolveString(value: DynamicValue | undefined, ctx: EvalContext, fallback = ""): string {
  const r = resolve(value, ctx);
  return r === undefined || r === null ? fallback : toText(r);
}

export function resolveNumber(value: DynamicValue | undefined, ctx: EvalContext, fallback = 0): number {
  return toNumber(resolve(value, ctx)) ?? fallback;
}

export function resolveBoolean(value: DynamicValue | undefined, ctx: EvalContext, fallback = false): boolean {
  const r = resolve(value, ctx);
  return r === undefined ? fallback : toBool(r);
}

export function resolveStringList(value: DynamicValue | undefined, ctx: EvalContext): string[] {
  const r = resolve(value, ctx);
  if (Array.isArray(r)) return r.filter((v) => v !== null).map(toText);
  if (typeof r === "string") return r === "" ? [] : [r];
  if (typeof r === "number") return [String(r)];
  return [];
}

// ── Functions ────────────────────────────────────────────────────────────────

const FUNCTIONS: Record<FunctionName, Fn> = {
  formatString: (a, ctx) => interpolate(toText(a.value), ctx),
  formatCurrency: (a) => formatCurrency(a.value, a.currency),
  formatNumber: (a) => formatNumber(a.value, a.decimals),
  formatDate: (a) => formatDate(toText(a.value), typeof a.format === "string" ? a.format : undefined),
  required: (a) => isPresent(a.value),
  numeric: (a) => {
    const n = toNumber(a.value);
    if (n === undefined) return false;
    const min = toNumber(a.min);
    const max = toNumber(a.max);
    return (min === undefined || n >= min) && (max === undefined || n <= max);
  },
  and: (a) => Array.isArray(a.values) && a.values.every(toBool),
  or: (a) => Array.isArray(a.values) && a.values.some(toBool),
  not: (a) => !toBool(a.value),
};

/** "${/abs/path}" and "${relative}" (resolved in the template scope); missing values become "". */
function interpolate(text: string, ctx: EvalContext): string {
  return text.replace(/\$\{([^}]*)\}/g, (_match, expr: string) => {
    const path = expr.trim();
    return path === "" ? "" : toText(readPath(path, ctx));
  });
}

function formatCurrency(value: JsonValue | undefined, currency: JsonValue | undefined): string {
  const n = toNumber(value);
  if (n === undefined) return "";
  const code = typeof currency === "string" && currency.trim() !== "" ? currency.trim().toUpperCase() : "EUR";
  // Whole amounts read better on stage without ".00".
  const fraction = Number.isInteger(n) ? 0 : 2;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency: code,
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2,
    }).format(n);
  } catch {
    return formatNumber(n, fraction) + " " + code;
  }
}

function formatNumber(value: JsonValue | undefined, decimals: JsonValue | undefined): string {
  const n = toNumber(value);
  if (n === undefined) return "";
  const d = toNumber(decimals);
  if (d === undefined) return new Intl.NumberFormat("en").format(n);
  const digits = Math.min(20, Math.max(0, Math.round(d)));
  return new Intl.NumberFormat("en", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}

// ── Dates ────────────────────────────────────────────────────────────────────

type DateParts = { y?: number; mo?: number; d?: number; h?: number; mi?: number };

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function validDate(y: number, mo: number, d: number): boolean {
  if (mo < 1 || mo > 12 || d < 1) return false;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  return probe.getUTCFullYear() === y && probe.getUTCMonth() === mo - 1 && probe.getUTCDate() === d;
}

function validTime(h: number, mi: number): boolean {
  return h >= 0 && h <= 23 && mi >= 0 && mi <= 59;
}

/** "YYYY-MM-DD", "HH:mm" or ISO date-time. Parsed by hand: new Date("YYYY-MM-DD") is UTC and shifts the day. */
export function parseDateValue(raw: string): DateParts | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    return validDate(y, mo, d) ? { y, mo, d } : null;
  }
  m = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(s);
  if (m) {
    const [h, mi] = [Number(m[1]), Number(m[2])];
    return validTime(h, mi) ? { h, mi } : null;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (!m) return null;
  if (m[6]) {
    // An explicit zone: show it in the viewer's local time.
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return null;
    return { y: dt.getFullYear(), mo: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes() };
  }
  const [y, mo, d, h, mi] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])];
  return validDate(y, mo, d) && validTime(h, mi) ? { y, mo, d, h, mi } : null;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function weekday(p: DateParts): number | undefined {
  if (p.y === undefined || p.mo === undefined || p.d === undefined) return undefined;
  return new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
}

const TOKENS: Record<string, (p: DateParts) => string | undefined> = {
  EEEE: (p) => {
    const w = weekday(p);
    return w === undefined ? undefined : WEEKDAYS[w];
  },
  EEE: (p) => {
    const w = weekday(p);
    return w === undefined ? undefined : WEEKDAYS[w].slice(0, 3);
  },
  d: (p) => (p.d === undefined ? undefined : String(p.d)),
  dd: (p) => (p.d === undefined ? undefined : pad2(p.d)),
  M: (p) => (p.mo === undefined ? undefined : String(p.mo)),
  MM: (p) => (p.mo === undefined ? undefined : pad2(p.mo)),
  MMM: (p) => (p.mo === undefined ? undefined : MONTHS[p.mo - 1].slice(0, 3)),
  MMMM: (p) => (p.mo === undefined ? undefined : MONTHS[p.mo - 1]),
  yyyy: (p) => (p.y === undefined ? undefined : String(p.y)),
  YYYY: (p) => (p.y === undefined ? undefined : String(p.y)),
  H: (p) => (p.h === undefined ? undefined : String(p.h)),
  HH: (p) => (p.h === undefined ? undefined : pad2(p.h)),
  h: (p) => (p.h === undefined ? undefined : String(p.h % 12 === 0 ? 12 : p.h % 12)),
  mm: (p) => (p.mi === undefined ? undefined : pad2(p.mi)),
  a: (p) => (p.h === undefined ? undefined : p.h < 12 ? "AM" : "PM"),
};

function defaultFormat(p: DateParts): string {
  const hasDate = p.d !== undefined;
  const hasTime = p.h !== undefined;
  if (hasDate && hasTime) return "EEE d MMM HH:mm";
  return hasDate ? "EEE d MMM" : "HH:mm";
}

/**
 * Small token formatter. Only a whole run of letters is a token, so words such as "at"
 * pass through untouched; 'quoted' text is always literal. Unparsable input is returned as is.
 */
export function formatDate(value: string, format?: string): string {
  const parts = parseDateValue(value);
  if (!parts) return value;
  const fmt = format && format.trim() !== "" ? format : defaultFormat(parts);
  return fmt.replace(/'([^']*)'|[A-Za-z]+/g, (run: string, quoted: string | undefined) => {
    if (quoted !== undefined) return quoted;
    const token = TOKENS[run];
    if (!token) return run;
    return token(parts) ?? "";
  });
}

// ── Checks and actions ───────────────────────────────────────────────────────

/** First failing check wins. A check that cannot be evaluated counts as failing, so a Button is never wrongly enabled. */
export function evalChecks(checks: CheckRule[] | undefined, ctx: EvalContext): { ok: boolean; message?: string } {
  if (!Array.isArray(checks)) return { ok: true };
  for (const check of checks) {
    let pass = false;
    try {
      pass = toBool(resolve(check.condition, ctx));
    } catch (err) {
      console.warn("[a2ui] check could not be evaluated", check, err);
    }
    if (!pass) return { ok: false, message: typeof check.message === "string" ? check.message : "" };
  }
  return { ok: true };
}

export function resolveActionContext(action: Action, ctx: EvalContext): JsonObject {
  const out: JsonObject = {};
  const context = action.event?.context;
  if (!isPlainObject(context)) return out;
  for (const [key, v] of Object.entries(context)) {
    try {
      out[key] = resolve(v, ctx) ?? null;
    } catch (err) {
      console.warn("[a2ui] action context value could not be resolved", key, err);
      out[key] = null;
    }
  }
  return out;
}
