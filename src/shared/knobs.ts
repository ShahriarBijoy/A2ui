/**
 * Surface → knobs; knobs → one Jev request; Jev answers → route decision + patches.
 * Shared by the client (deriveKnobs builds TurnRequest.surface.knobs) and the Worker router.
 * Keep this file free of DOM, Node and Bun APIs: it compiles under both configs.
 */
import { isPathBinding } from "./a2ui";
import type { CatalogComponent, DynamicString, DynamicStringList, JsonObject, JsonValue } from "./a2ui";
import { getAt, parsePointer } from "./pointer";
import { LIMITS } from "./protocol";
import type { Knob, KnobOption, RoutePatch, RouteResult } from "./protocol";

// ── Jev wire types (TypeSafe System One, see NOTES.md "Jev") ─────────────────
export type JevChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type JevNoulQuestion = { type: "noul"; instructions: string; criteria?: { true: string; false: string } };
export type JevQuestion = JevChoiceQuestion | JevNoulQuestion;
export type JevQuestions = Record<string, JevQuestion>;

export type JevChoiceAnswer = { type: "choice"; choice: string; confidence: number; probabilities: Record<string, number> };
export type JevNoulAnswer = { type: "noul"; noul: number };
export type JevAnswer = JevChoiceAnswer | JevNoulAnswer;
export type JevAnswers = Record<string, JevAnswer>;
export type JevUsage = { input_tokens: number; output_tokens: number };

export type RouteRequest = { state: JsonObject; questions: JevQuestions };

/** Criteria key for "leave this knob alone". Option keys equal to it are dropped. */
export const UNCHANGED = "unchanged";
export const KIND_QUESTION = "kind";

const STEPPER_DEFAULT_MIN = 1;
const STEPPER_DEFAULT_MAX = 20;
const NUMBER_OPTION_CAP = 60;
/** Choice criteria allow 255 keys; one is "unchanged". */
const MAX_CHOICE_OPTIONS = 254;
const DATE_DAYS_AHEAD = 14;
/** Half-hour slots within ±6 h of the current time: 24 options instead of 47. */
const TIME_WINDOW_MIN = 6 * 60;

// ── deriveKnobs ──────────────────────────────────────────────────────────────

/** Every input component whose value is {"@path": "/absolute"}. TextField is never a knob. */
export function deriveKnobs(components: CatalogComponent[], data: JsonValue, now: Date = new Date()): Knob[] {
  const knobs: Knob[] = [];
  const seen = new Set<string>();
  for (const c of components) {
    if (c.component === "TextField") continue;
    if (!("value" in c) || !isPathBinding(c.value)) continue;
    const path = c.value["@path"];
    // Relative paths only exist inside List templates: one component, many values, so not a knob.
    if (!path.startsWith("/") || seen.has(path)) continue;
    let knob: Knob | null = null;
    try {
      knob = componentKnob(c, path, data, now);
    } catch {
      // A malformed component must not take the whole turn down; it simply is not a knob.
      knob = null;
    }
    if (knob) {
      seen.add(path);
      knobs.push(knob);
    }
  }
  return knobs;
}

function componentKnob(c: CatalogComponent, path: string, data: JsonValue, now: Date): Knob | null {
  const current = getAt(data, path);
  const base = { id: path, componentId: c.id, path, label: knobLabel("label" in c ? c.label : undefined, path) };
  switch (c.component) {
    case "Stepper": {
      const min = finite(c.min) ? Math.ceil(c.min) : STEPPER_DEFAULT_MIN;
      const max = finite(c.max) ? Math.floor(c.max) : STEPPER_DEFAULT_MAX;
      return numberKnob({ ...base, component: "Stepper" }, current, min, max, 1);
    }
    case "Slider": {
      if (!finite(c.min) || !finite(c.max) || c.max <= c.min) return null;
      return numberKnob({ ...base, component: "Slider" }, current, c.min, c.max, sliderStep(c.min, c.max, c.steps));
    }
    case "ChoicePicker": {
      const options = c.options
        .filter((o) => typeof o.value === "string")
        .map((o) => ({ value: o.value, label: resolveString(o.label, data) ?? o.value }));
      const selected = toStringList(current);
      if (c.variant === "multipleSelection") {
        const opts = uniqueBy(options, (o) => o.value)
          .filter((o) => o.value !== UNCHANGED)
          .map((o) => ({ key: o.value, label: o.label, value: o.value }));
        if (opts.length === 0) return null;
        return { ...base, component: "ChoicePicker", type: "multi", current: selected, options: opts };
      }
      const sel = selected[0];
      const opts = uniqueBy(options, (o) => o.value)
        .filter((o) => o.value !== sel && o.value !== UNCHANGED)
        .map((o) => ({ key: o.value, label: o.label, value: [o.value] }));
      if (opts.length === 0) return null;
      const currentLabel = sel === undefined ? "none selected" : (options.find((o) => o.value === sel)?.label ?? sel);
      return {
        ...base,
        component: "ChoicePicker",
        type: "choice",
        current: current ?? [],
        currentLabel,
        options: opts.slice(0, MAX_CHOICE_OPTIONS),
      };
    }
    case "CheckBox":
      return { ...base, component: "CheckBox", type: "bool", current: current === true };
    case "DateTimeInput":
      return dateTimeKnob({ ...base, component: "DateTimeInput" }, c.enableDate, c.enableTime, current, now);
    case "SeatMap":
      return seatKnob({ ...base, component: "SeatMap" }, c.rows, c.layout, c.taken, current, data);
    default:
      return null;
  }
}

type BaseFields = { id: string; componentId: string; path: string; label: string; component: Knob["component"] };
type ChoiceKnob = Extract<Knob, { type: "choice" }>;

function numberKnob(base: BaseFields, current: JsonValue | undefined, min: number, max: number, step: number): ChoiceKnob | null {
  if (!(step > 0) || max < min) return null;
  const cur = typeof current === "number" && Number.isFinite(current) ? current : null;
  const values: number[] = [];
  // Index-based so float steps (0.1) do not accumulate error.
  const count = Math.floor((max - min) / step + 1e-9);
  for (let i = 0; i <= count; i++) {
    const v = round10(min + i * step);
    if (v !== cur) values.push(v);
  }
  let kept = values;
  if (values.length > NUMBER_OPTION_CAP) {
    const anchor = cur ?? min;
    kept = values
      .slice()
      .sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor) || a - b)
      .slice(0, NUMBER_OPTION_CAP)
      .sort((a, b) => a - b);
  }
  if (kept.length === 0) return null;
  return {
    ...base,
    type: "choice",
    current: current ?? null,
    currentLabel: cur === null ? "not set" : String(cur),
    options: kept.map((v) => ({ key: String(v), label: String(v), value: v })),
  };
}

/**
 * A2UI's Slider "steps" is ambiguous (step size vs. number of steps). An LLM writing
 * {min: 0, max: 2000, steps: 100} means step size 100, so that is the default reading;
 * only when steps exceeds the range ({min: 0, max: 1, steps: 10}) is it a count.
 */
export function sliderStep(min: number, max: number, steps: number | undefined): number {
  const range = max - min;
  if (finite(steps) && steps > 0) {
    if (steps <= range) return steps;
    return range / Math.round(steps);
  }
  return range > 1 ? 1 : range / 10;
}

function dateTimeKnob(
  base: BaseFields,
  enableDate: boolean | undefined,
  enableTime: boolean | undefined,
  current: JsonValue | undefined,
  now: Date,
): ChoiceKnob | null {
  const cur = typeof current === "string" ? current : "";
  const curDate = /^(\d{4})-(\d{2})-(\d{2})/.exec(cur);
  const curTime = /(?:^|T)(\d{2}):(\d{2})/.exec(cur);
  let hasDate: boolean;
  let hasTime: boolean;
  if (enableDate !== undefined || enableTime !== undefined) {
    hasDate = enableDate ?? !enableTime;
    hasTime = enableTime ?? false;
  } else if (cur) {
    hasDate = curDate !== null;
    hasTime = curTime !== null;
  } else {
    hasDate = true;
    hasTime = false;
  }
  if (!hasDate && hasTime) return timeKnob(base, curTime ? Number(curTime[1]) * 60 + Number(curTime[2]) : null);
  if (!hasDate) return null;
  // Date + time: the date is the knob, the time is carried over unchanged.
  let keepTime = "";
  if (hasTime) {
    if (!curTime) return null;
    keepTime = "T" + curTime[1] + ":" + curTime[2];
  }
  return dateKnob(base, curDate ? curDate[0] : null, keepTime, now);
}

function timeKnob(base: BaseFields, curMin: number | null): ChoiceKnob | null {
  const options: KnobOption[] = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    if (m === curMin) continue;
    if (curMin !== null && Math.abs(m - curMin) > TIME_WINDOW_MIN) continue;
    const key = hhmm(m);
    options.push({ key, label: curMin === null ? key : key + " (" + relativeMinutes(m - curMin) + ")", value: key });
  }
  if (options.length === 0) return null;
  return {
    ...base,
    type: "choice",
    current: curMin === null ? null : hhmm(curMin),
    currentLabel: curMin === null ? "not set" : hhmm(curMin),
    options,
  };
}

function dateKnob(base: BaseFields, curIso: string | null, keepTime: string, now: Date): ChoiceKnob | null {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const options: KnobOption[] = [];
  for (let i = 0; i <= DATE_DAYS_AHEAD; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const iso = isoDate(d);
    if (iso === curIso) continue;
    options.push({ key: shortDate(d), label: longDate(d) + " (" + relativeDays(i) + ")", value: iso + keepTime });
  }
  let currentLabel = "not set";
  if (curIso) {
    const [y, m, dd] = curIso.split("-").map(Number);
    const d = new Date(y, m - 1, dd);
    const diff = Math.round((d.getTime() - today.getTime()) / 86_400_000);
    currentLabel = longDate(d) + " (" + relativeDays(diff) + ")";
    if (keepTime) currentLabel += ", " + keepTime.slice(1);
  }
  return { ...base, type: "choice", current: curIso ? curIso + keepTime : null, currentLabel, options };
}

function seatKnob(
  base: BaseFields,
  rows: number,
  layout: string,
  taken: DynamicStringList | undefined,
  current: JsonValue | undefined,
  data: JsonValue,
): ChoiceKnob | null {
  if (!finite(rows) || rows < 1 || typeof layout !== "string") return null;
  const takenSet = new Set(resolveStringList(taken, data));
  const cur = typeof current === "string" ? current : null;
  const letters = layout.split("").filter((ch) => ch.trim() !== "");
  const positions = seatPositions(layout);
  const curRow = cur ? Number.parseInt(cur, 10) : NaN;
  const seats: { key: string; row: number; label: string }[] = [];
  for (let r = 1; r <= Math.floor(rows); r++) {
    for (const letter of letters) {
      const key = String(r) + letter;
      if (key === cur || takenSet.has(key)) continue;
      seats.push({ key, row: r, label: "Row " + r + ", seat " + letter + " (" + (positions.get(letter) ?? "seat") + ")" });
    }
  }
  let kept = seats;
  if (seats.length > MAX_CHOICE_OPTIONS && Number.isFinite(curRow)) {
    kept = seats
      .map((s, i) => ({ s, i }))
      .sort((a, b) => Math.abs(a.s.row - curRow) - Math.abs(b.s.row - curRow) || a.i - b.i)
      .slice(0, MAX_CHOICE_OPTIONS)
      .sort((a, b) => a.i - b.i)
      .map((x) => x.s);
  }
  kept = kept.slice(0, MAX_CHOICE_OPTIONS);
  if (kept.length === 0) return null;
  return {
    ...base,
    type: "choice",
    current: current ?? null,
    currentLabel: cur ?? "none selected",
    options: kept.map((s) => ({ key: s.key, label: s.label, value: s.key })),
  };
}

/** "ABC DEF" → A,F window; C,D aisle; B,E middle. Lets "a window seat" resolve. */
function seatPositions(layout: string): Map<string, string> {
  const out = new Map<string, string>();
  const chars = layout.split("");
  const first = chars.findIndex((ch) => ch.trim() !== "");
  let last = -1;
  for (let i = chars.length - 1; i >= 0; i--) {
    if (chars[i].trim() !== "") {
      last = i;
      break;
    }
  }
  chars.forEach((ch, i) => {
    if (ch.trim() === "") return;
    const nearAisle = (i > 0 && chars[i - 1] === " ") || (i < chars.length - 1 && chars[i + 1] === " ");
    out.set(ch, i === first || i === last ? "window" : nearAisle ? "aisle" : "middle");
  });
  return out;
}

// ── buildRouteRequest ────────────────────────────────────────────────────────

/**
 * "edit" must mean ONLY knob values: "to New York on friday" or "somewhere closer, and later"
 * would otherwise patch the date/time and silently drop the rest (measured in scripts/jev-eval.ts:
 * this wording routes all 17 eval lines right; the looser one let 4 mixed lines patch).
 */
const KIND_CRITERIA: Record<string, string> = {
  edit: "Only change values that are in screen",
  new: "Anything else: a value that is not in screen (such as a destination or a name), confirming, booking, the next step, a new question, or a different task",
  other: "Small talk, thinking aloud, or unclear",
};

/** Change framing ("does the speaker ask to select X?"): a final-state question drifts to ~0.5 for unmentioned options. */
function changeNoul(verb: string, name: string, state: string): JevNoulQuestion {
  return {
    type: "noul",
    instructions: "Does the speaker ask to " + verb + " '" + name + "'? It is currently " + state + ".",
    criteria: { true: "The speaker asks to " + verb + " it", false: "Not mentioned, or something else is asked" },
  };
}

/** Question id of a choice/bool knob, or of one option of a multi knob. */
export function knobQuestionId(index: number, option?: number): string {
  return option === undefined ? "k" + index : "k" + index + "_" + option;
}

export function buildRouteRequest(utterance: string, knobs: Knob[]): RouteRequest {
  const screen: JsonObject = {};
  const questions: JevQuestions = {
    [KIND_QUESTION]: {
      type: "choice",
      instructions:
        "The speaker is looking at a screen that shows the values in screen. What does the speaker want with this request?",
      criteria: KIND_CRITERIA,
    },
  };
  knobs.forEach((knob, i) => {
    screen[uniqueKey(screen, knob.label)] = knobCurrentLabel(knob);
    if (knob.type === "choice") {
      const criteria: Record<string, string> = { [UNCHANGED]: "No change asked for " + knob.label };
      for (const o of knob.options) {
        if (o.key !== UNCHANGED && !(o.key in criteria)) criteria[o.key] = o.label;
      }
      if (Object.keys(criteria).length < 2) return;
      const flavour = knobFlavour(knob);
      questions[knobQuestionId(i)] = {
        type: "choice",
        instructions:
          "What should '" + knob.label + "' be after this request? Current value: " + knob.currentLabel + "." + RELATIVE_HINT[flavour],
        criteria,
      };
    } else if (knob.type === "multi") {
      knob.options.forEach((o, j) => {
        const on = knob.current.includes(String(o.value));
        questions[knobQuestionId(i, j)] = changeNoul(on ? "deselect" : "select", o.label, on ? "selected" : "not selected");
      });
    } else {
      questions[knobQuestionId(i)] = changeNoul(
        knob.current ? "uncheck" : "check",
        knob.label,
        knob.current ? "checked" : "not checked",
      );
    }
  });
  return { state: { utterance, screen }, questions };
}

type Flavour = "time" | "date" | "number" | "plain";

const RELATIVE_HINT: Record<Flavour, string> = {
  time: " If the speaker only says later or earlier without a time, pick one hour later or earlier.",
  date: " If the speaker only says later, earlier or the day after without a date, pick one day after or before the current value.",
  number: " If the speaker only says more or fewer without a number, pick one more or one fewer. A couple means two.",
  plain: "",
};

/** The contract Knob has no "scale" field, so infer it: the dinner Time is a ChoicePicker of "HH:mm" chips. */
function knobFlavour(knob: ChoiceKnob): Flavour {
  if (knob.component === "Stepper" || knob.component === "Slider") return "number";
  if (knob.component === "SeatMap") return "plain";
  const keys = knob.options.map((o) => o.key);
  const values = knob.options.map((o) => (Array.isArray(o.value) ? o.value[0] : o.value));
  if (keys.length === 0) return "plain";
  if (keys.every((k) => /^\d{1,2}:\d{2}$/.test(k))) return "time";
  if (values.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v))) return "date";
  if (keys.every((k) => /^-?\d+(\.\d+)?$/.test(k))) return "number";
  return "plain";
}

function knobCurrentLabel(knob: Knob): string {
  if (knob.type === "choice") return knob.currentLabel;
  if (knob.type === "bool") return knob.current ? "checked" : "not checked";
  const on = knob.options.filter((o) => knob.current.includes(String(o.value))).map((o) => o.label);
  // List the options: otherwise "add gluten free" reads as a value that is not on the screen (measured: new@0.65).
  return (on.length ? on.join(", ") : "none selected") + " (options: " + knob.options.map((o) => o.label).join(", ") + ")";
}

function uniqueKey(obj: JsonObject, key: string): string {
  if (!(key in obj)) return key;
  for (let n = 2; ; n++) if (!(key + " (" + n + ")" in obj)) return key + " (" + n + ")";
}

// ── answersToRoute ───────────────────────────────────────────────────────────

type KnobOutcome =
  | { status: "unchanged" }
  | { status: "partial"; label: string }
  | { status: "changed"; patch: RoutePatch; display: string };

export function answersToRoute(answers: JevAnswers, knobs: Knob[], ms: number, engine: string): RouteResult {
  const compose = (kind: RouteResult["kind"], kindConfidence: number, reason: string): RouteResult => ({
    kind,
    kindConfidence,
    decision: "compose",
    patches: [],
    ms,
    engine,
    reason,
  });
  const kindAns = answers[KIND_QUESTION];
  if (!kindAns || kindAns.type !== "choice") return compose("other", 0, "no kind answer");
  const kind = argmax(kindAns.probabilities) ?? kindAns.choice;
  const routeKind: RouteResult["kind"] = kind === "edit" || kind === "new" ? kind : "other";
  const kindP = kindAns.probabilities[kind] ?? 0;
  const kindConfidence = routeKind === "edit" ? (kindAns.probabilities.edit ?? 0) : kindP;
  if (routeKind !== "edit") return compose(routeKind, kindConfidence, "not an edit (" + routeKind + " " + fmt(kindP) + ")");
  if (kindConfidence < LIMITS.routeKindThreshold) return compose("edit", kindConfidence, "unsure it is an edit (" + fmt(kindConfidence) + ")");

  const patches: RoutePatch[] = [];
  const shown: string[] = [];
  for (let i = 0; i < knobs.length; i++) {
    const outcome = knobOutcome(knobs[i], i, answers);
    if (outcome.status === "partial") return compose("edit", kindConfidence, "partial edit: " + outcome.label);
    if (outcome.status === "changed") {
      patches.push(outcome.patch);
      shown.push(outcome.display);
    }
  }
  if (patches.length === 0) return compose("edit", kindConfidence, "edit, but no knob changed");
  return {
    kind: "edit",
    kindConfidence,
    decision: "patch",
    patches,
    ms,
    engine,
    reason: "edit " + fmt(kindConfidence) + ": " + shown.join(", "),
  };
}

function knobOutcome(knob: Knob, index: number, answers: JevAnswers): KnobOutcome {
  const threshold = LIMITS.routeKnobThreshold;
  if (knob.type === "choice") {
    const ans = answers[knobQuestionId(index)];
    if (!ans || ans.type !== "choice") return { status: "unchanged" };
    const probs = ans.probabilities;
    const pUnchanged = probs[UNCHANGED] ?? 0;
    let bestKey: string | null = null;
    let bestP = -1;
    for (const o of knob.options) {
      const p = probs[o.key];
      if (typeof p === "number" && p > bestP) {
        bestKey = o.key;
        bestP = p;
      }
    }
    const top = argmax(probs);
    // Speaker asked to change it (low P(unchanged), or a change is the top answer) but no option is clear.
    const askedToChange = pUnchanged < 1 - threshold || (top !== null && top !== UNCHANGED);
    if (bestKey === null || bestP < threshold) return askedToChange ? { status: "partial", label: knob.label } : { status: "unchanged" };
    if (top === UNCHANGED) return { status: "unchanged" };
    const option = knob.options.find((o) => o.key === bestKey);
    if (!option) return { status: "unchanged" };
    return {
      status: "changed",
      patch: { knobId: knob.id, path: knob.path, value: option.value, confidence: bestP },
      display: knob.label + " → " + option.key,
    };
  }
  // Nouls are P(the speaker asks to flip it): flip at ≥ 0.6, keep at ≤ 0.4, in between is half an edit.
  if (knob.type === "bool") {
    const p = noul(answers[knobQuestionId(index)]);
    if (p === null || p <= 1 - threshold) return { status: "unchanged" };
    if (p < threshold) return { status: "partial", label: knob.label };
    const next = !knob.current;
    return {
      status: "changed",
      patch: { knobId: knob.id, path: knob.path, value: next, confidence: p },
      display: knob.label + " → " + (next ? "on" : "off"),
    };
  }
  // multi: one patch with the whole new array, in option order.
  const selected = new Set(knob.current);
  let minConfidence = 1;
  let flipped = false;
  for (let j = 0; j < knob.options.length; j++) {
    const o = knob.options[j];
    const p = noul(answers[knobQuestionId(index, j)]);
    if (p === null || p <= 1 - threshold) continue;
    if (p < threshold) return { status: "partial", label: knob.label + ": " + o.label };
    const value = String(o.value);
    flipped = true;
    minConfidence = Math.min(minConfidence, p);
    if (selected.has(value)) selected.delete(value);
    else selected.add(value);
  }
  if (!flipped) return { status: "unchanged" };
  const optionValues = knob.options.map((o) => String(o.value));
  // Keep selections the knob does not know about (not in options) after the known ones.
  const value = [...optionValues.filter((v) => selected.has(v)), ...knob.current.filter((v) => !optionValues.includes(v) && selected.has(v))];
  const labels = knob.options.filter((o) => selected.has(String(o.value))).map((o) => o.label);
  return {
    status: "changed",
    patch: { knobId: knob.id, path: knob.path, value, confidence: minConfidence },
    display: knob.label + " → " + (labels.length ? labels.join(", ") : "none"),
  };
}

function noul(a: JevAnswer | undefined): number | null {
  return a && a.type === "noul" && Number.isFinite(a.noul) ? a.noul : null;
}

function argmax(probs: Record<string, number>): string | null {
  let best: string | null = null;
  let bestP = -Infinity;
  for (const [k, p] of Object.entries(probs)) {
    if (typeof p === "number" && p > bestP) {
      best = k;
      bestP = p;
    }
  }
  return best;
}

// ── small helpers ────────────────────────────────────────────────────────────

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

function isoDate(d: Date): string {
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
/** "Sat 28 Nov" */
function shortDate(d: Date): string {
  return WEEKDAYS[d.getDay()].slice(0, 3) + " " + d.getDate() + " " + MONTHS[d.getMonth()].slice(0, 3);
}
/** "Saturday 28 November 2026" */
function longDate(d: Date): string {
  return WEEKDAYS[d.getDay()] + " " + d.getDate() + " " + MONTHS[d.getMonth()] + " " + d.getFullYear();
}
function relativeDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? "in " + n + " days" : -n + " days ago";
}
function hhmm(minutes: number): string {
  return pad2(Math.floor(minutes / 60)) + ":" + pad2(minutes % 60);
}
function relativeMinutes(diff: number): string {
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  const amount = h && m ? h + " h " + m + " min" : h ? h + " h" : m + " min";
  return amount + (diff > 0 ? " later" : " earlier");
}
function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}
function round10(n: number): number {
  return Math.round(n * 1e10) / 1e10;
}
function fmt(p: number): string {
  return p.toFixed(2);
}
function finite(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

function knobLabel(label: DynamicString | undefined, path: string): string {
  const literal = typeof label === "string" ? label.trim() : "";
  if (literal) return literal;
  const tokens = parsePointer(path);
  return humanise(tokens[tokens.length - 1] ?? "value");
}

/** "returnFlight" / "depart_date" → "Return flight" / "Depart date". */
export function humanise(token: string): string {
  const words = token
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Value";
}

function resolveString(v: DynamicString, data: JsonValue): string | null {
  if (typeof v === "string") return v;
  if (isPathBinding(v) && v["@path"].startsWith("/")) {
    const got = getAt(data, v["@path"]);
    return typeof got === "string" ? got : null;
  }
  return null;
}

function resolveStringList(v: DynamicStringList | undefined, data: JsonValue): string[] {
  if (v === undefined) return [];
  if (Array.isArray(v)) return v.filter((s): s is string => typeof s === "string");
  if (isPathBinding(v) && v["@path"].startsWith("/")) return toStringList(getAt(data, v["@path"]));
  return [];
}

function toStringList(v: JsonValue | undefined): string[] {
  if (typeof v === "string") return [v];
  if (Array.isArray(v)) return v.filter((s): s is string => typeof s === "string");
  return [];
}

function uniqueBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
