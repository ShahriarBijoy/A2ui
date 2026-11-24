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
export const GUARD_QUESTION = "guard";
/** P(the request also asks for something no knob can express) at or above this → compose. */
export const GUARD_THRESHOLD = 0.5;

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
    } catch (err) {
      // One malformed component must not take the turn down: skip it, but leave a trace for rehearsal.
      console.warn("deriveKnobs: skipped component", c.id, c.component, err instanceof Error ? err.message : String(err));
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
  const curGrid = cur === null ? null : round10(cur);
  // Index-based so float steps (0.1) do not accumulate error.
  const count = Math.floor((max - min) / step + 1e-9);
  const at = (i: number) => round10(min + i * step);
  // Walk outward from the current value (ties: lower first). O(cap) even for LLM-written ranges like 0..5,000,000.
  const anchor = cur ?? min;
  let lo = Math.min(count, Math.max(0, Math.floor((anchor - min) / step)));
  let hi = lo + 1;
  const kept: number[] = [];
  while (kept.length < NUMBER_OPTION_CAP && (lo >= 0 || hi <= count)) {
    const takeLo = lo >= 0 && (hi > count || Math.abs(at(lo) - anchor) <= Math.abs(at(hi) - anchor));
    const v = takeLo ? at(lo--) : at(hi++);
    if (v !== curGrid) kept.push(v);
  }
  kept.sort((a, b) => a - b);
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
  if (hasTime) {
    if (!curTime || !curDate) return null;
    return dateTimeBothKnob(base, curDate[0], Number(curTime[1]) * 60 + Number(curTime[2]), now);
  }
  return dateKnob(base, curDate ? curDate[0] : null, now);
}

function timeKnob(base: BaseFields, curMin: number | null): ChoiceKnob | null {
  const slots: { m: number; diff: number }[] = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    if (m === curMin) continue;
    // Circular distance: from 23:00, "later" must reach 00:00 (measured: without wrap it composed).
    const diff = curMin === null ? m : ((m - curMin + 720 + 1440) % 1440) - 720;
    if (curMin !== null && Math.abs(diff) > TIME_WINDOW_MIN) continue;
    slots.push({ m, diff });
  }
  slots.sort((a, b) => a.diff - b.diff);
  const options: KnobOption[] = slots.map(({ m, diff }) => {
    const key = hhmm(m);
    return { key, label: curMin === null ? key : key + " (" + relativeMinutes(diff) + ")", value: key };
  });
  if (options.length === 0) return null;
  return {
    ...base,
    type: "choice",
    current: curMin === null ? null : hhmm(curMin),
    currentLabel: curMin === null ? "not set" : hhmm(curMin),
    options,
  };
}

function dateKnob(base: BaseFields, curIso: string | null, now: Date): ChoiceKnob | null {
  return {
    ...base,
    type: "choice",
    current: curIso,
    currentLabel: curIso ? dateLabel(curIso, now) : "not set",
    options: dateOptions(curIso, now, ""),
  };
}

/** today..today+14 except the current date; `suffix` carries a time part ("T19:00") unchanged. */
function dateOptions(curIso: string | null, now: Date, suffix: string): KnobOption[] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const options: KnobOption[] = [];
  for (let i = 0; i <= DATE_DAYS_AHEAD; i++) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + i);
    const iso = isoDate(d);
    if (iso === curIso) continue;
    options.push({ key: shortDate(d), label: longDate(d) + " (" + relativeDays(i) + ")", value: iso + suffix });
  }
  return options;
}

function dateLabel(iso: string, now: Date): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [y, m, dd] = iso.split("-").map(Number);
  const d = new Date(y, m - 1, dd);
  return longDate(d) + " (" + relativeDays(Math.round((d.getTime() - today.getTime()) / 86_400_000)) + ")";
}

/**
 * Date + time: one knob (one path) with two option sets. Date options keep the time; time slots
 * (±6 h, circular) keep the date, crossing midnight into the next/previous date. buildRouteRequest
 * asks one question per part. As a date-only knob, "We're six, and later." moved the date to the
 * next day and "at nine on Friday" silently dropped the nine (smoke run + reproduction).
 */
function dateTimeBothKnob(base: BaseFields, curIso: string, curMin: number, now: Date): ChoiceKnob {
  const time = hhmm(curMin);
  const [y, mo, d] = curIso.split("-").map(Number);
  const slots: { m: number; diff: number }[] = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    if (m === curMin) continue;
    const diff = ((m - curMin + 720 + 1440) % 1440) - 720;
    if (Math.abs(diff) <= TIME_WINDOW_MIN) slots.push({ m, diff });
  }
  slots.sort((a, b) => a.diff - b.diff);
  const timeOptions: KnobOption[] = slots.map(({ m, diff }) => {
    const shift = curMin + diff < 0 ? -1 : curMin + diff >= 24 * 60 ? 1 : 0;
    const date = isoDate(new Date(y, mo - 1, d + shift));
    const day = shift > 0 ? ", next day" : shift < 0 ? ", previous day" : "";
    return { key: hhmm(m), label: hhmm(m) + " (" + relativeMinutes(diff) + day + ")", value: date + "T" + hhmm(m) };
  });
  return {
    ...base,
    type: "choice",
    current: curIso + "T" + time,
    currentLabel: dateLabel(curIso, now) + ", " + time,
    options: [...dateOptions(curIso, now, "T" + time), ...timeOptions],
  };
}

const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const TIME_KEY_RE = /^\d{2}:\d{2}$/;

/** A date+time knob (see dateTimeBothKnob): its options split into date options and time slots by key. */
function isDateTimeKnob(knob: ChoiceKnob): boolean {
  return knob.component === "DateTimeInput" && typeof knob.current === "string" && DATETIME_RE.test(knob.current);
}

function splitDateTime(knob: ChoiceKnob): { dates: KnobOption[]; times: KnobOption[] } {
  return {
    dates: knob.options.filter((o) => !TIME_KEY_RE.test(o.key)),
    times: knob.options.filter((o) => TIME_KEY_RE.test(o.key)),
  };
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
  if (letters.length === 0) return null;
  const positions = seatPositions(layout);
  const rowCount = Math.floor(rows);
  const curRow = cur ? Number.parseInt(cur, 10) : NaN;
  const start = Number.isFinite(curRow) ? Math.min(rowCount, Math.max(1, curRow)) : 1;
  const kept: { key: string; row: number; col: number; label: string }[] = [];
  // Walk rows outward from the current seat (or from row 1), nearer rows first: O(cap) for any row count.
  for (let d = 0; kept.length < MAX_CHOICE_OPTIONS && (start - d >= 1 || start + d <= rowCount); d++) {
    for (const r of d === 0 ? [start] : [start - d, start + d]) {
      if (r < 1 || r > rowCount) continue;
      letters.forEach((letter, col) => {
        const key = String(r) + letter;
        if (kept.length >= MAX_CHOICE_OPTIONS || key === cur || takenSet.has(key)) return;
        kept.push({ key, row: r, col, label: "Row " + r + ", seat " + letter + " (" + (positions.get(letter) ?? "seat") + ")" });
      });
    }
  }
  kept.sort((a, b) => a.row - b.row || a.col - b.col);
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
 * "edit" must mean ONLY knob values: "to New York on friday" would otherwise patch the date and
 * silently drop the rest. The follow-up sentence keeps terse edits ("later please", "the day after")
 * from reading as new tasks (measured: P(edit) 0.26 → 0.86–0.95). Mixed lines the kind question
 * still calls edits are caught by the guard Noul below.
 */
const KIND_INSTRUCTIONS =
  "The speaker is looking at a screen that shows the values in screen. What does the speaker want with this request?" +
  " Short follow-ups such as 'later', 'earlier', 'the day after' or 'two more' change the values in screen.";
const KIND_CRITERIA: Record<string, string> = {
  edit: "Only change values that are in screen",
  new: "Anything else: a value that is not in screen (such as a place, a destination or a name), confirming, booking, the next step, a new question, or a different task",
  other: "Small talk, thinking aloud, or unclear",
};

/**
 * Catches the silent drop: on a Guests-only screen "We're six, and later." patched Guests and lost
 * "later". Naming the changeable values matters: the generic "something NOT among the values in
 * screen" fired at 0.46–0.86 on plain edits; this one stays ≤ 0.29 on them (measured, 49 lines).
 */
function guardQuestion(knobs: Knob[]): JevNoulQuestion {
  const labels = uniqueBy(knobs.map((k) => k.label), (l) => l).join(", ");
  return {
    type: "noul",
    instructions:
      "The only values that can change on this screen are: " + labels + ". Does the speaker also ask for something that is not one of these?",
    criteria: {
      true: "Part of the request is about something other than " + labels + ", such as a place, an extra item or another detail",
      false: "The whole request is about " + labels + ", or it changes nothing",
    },
  };
}

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

/** Question id of the time part of a date+time knob (k<i> is its date part). */
export function knobTimeQuestionId(index: number): string {
  return "k" + index + "t";
}

export function buildRouteRequest(utterance: string, knobs: Knob[]): RouteRequest {
  const screen: JsonObject = {};
  const questions: JevQuestions = {
    [KIND_QUESTION]: { type: "choice", instructions: KIND_INSTRUCTIONS, criteria: KIND_CRITERIA },
  };
  // Time words belong to a time knob when the screen has one; a date-only knob must never claim them.
  const hasTimeKnob = knobs.some((k) => k.type === "choice" && (isDateTimeKnob(k) || knobFlavour(k) === "time"));
  knobs.forEach((knob, i) => {
    screen[uniqueKey(screen, knob.label)] = knobCurrentLabel(knob);
    if (knob.type === "choice" && isDateTimeKnob(knob)) {
      Object.assign(questions, dateTimeQuestions(knob, i));
    } else if (knob.type === "choice") {
      const criteria: Record<string, string> = { [UNCHANGED]: "No change asked for " + knob.label };
      for (const o of knob.options) {
        if (o.key !== UNCHANGED && !Object.hasOwn(criteria, o.key)) criteria[o.key] = o.label;
      }
      if (Object.keys(criteria).length < 2) return;
      const flavour = knobFlavour(knob);
      const hint = flavour === "date" ? dateHint(knob, hasTimeKnob) : relativeHint(knob, flavour);
      for (const [key, text] of Object.entries(hint.sentinels)) if (!Object.hasOwn(criteria, key)) criteria[key] = text;
      questions[knobQuestionId(i)] = {
        type: "choice",
        instructions: "What should '" + knob.label + "' be after this request? Current value: " + knob.currentLabel + "." + hint.text,
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
  if (knobs.length > 0) questions[GUARD_QUESTION] = guardQuestion(knobs);
  return { state: { utterance, screen }, questions };
}

/** Two questions over one path: which date (only a named day changes it) and which time (later/earlier, "at nine"). */
function dateTimeQuestions(knob: ChoiceKnob, index: number): JevQuestions {
  const { dates, times } = splitDateTime(knob);
  const curDate = (knob.current as string).slice(0, 10);
  const curTime = (knob.current as string).slice(11, 16);
  const dateCriteria: Record<string, string> = { [UNCHANGED]: "No change asked for the date" };
  for (const o of dates) if (!Object.hasOwn(dateCriteria, o.key)) dateCriteria[o.key] = o.label;
  const timeCriteria: Record<string, string> = { [UNCHANGED]: "No change asked for the time" };
  for (const o of times) if (!Object.hasOwn(timeCriteria, o.key)) timeCriteria[o.key] = o.label;
  const [y, m, d] = curDate.split("-").map(Number);
  const dayAfter = dates.find((o) => String(o.value).startsWith(isoDate(new Date(y, m - 1, d + 1))));
  const dateHint =
    " Only a named day changes the date (such as 'on Friday', 'tomorrow' or 'the day after')." +
    (dayAfter ? " If the speaker says the day after, pick " + dayAfter.key + "." : "") +
    " Later, earlier or a time of day alone leave the date unchanged.";
  const timeHint = relativeHint({ ...knob, current: curTime, options: times }, "time").text + " A day name alone (such as 'on Friday') leaves the time unchanged.";
  const dateLabelText = knob.currentLabel.slice(0, knob.currentLabel.lastIndexOf(", "));
  return {
    [knobQuestionId(index)]: {
      type: "choice",
      instructions: "What should the date of '" + knob.label + "' be after this request? Current date: " + dateLabelText + "." + dateHint,
      criteria: dateCriteria,
    },
    [knobTimeQuestionId(index)]: {
      type: "choice",
      instructions: "What should the time of '" + knob.label + "' be after this request? Current time: " + curTime + "." + timeHint,
      criteria: timeCriteria,
    },
  };
}

type Flavour = "time" | "date" | "number" | "plain";

const RELATIVE_HINT: Record<Flavour, string> = {
  time: " If the speaker only says later or earlier without a time, pick one hour later or earlier.",
  date: " If the speaker only says later, earlier or the day after without a date, pick one day after or before the current value.",
  number: " If the speaker only says more or fewer without a number, pick one more or one fewer. A couple means two.",
  plain: "",
};

/**
 * Time knobs name the concrete answer for a bare "later"/"earlier" (code does the arithmetic), one
 * clause per direction, and say that a count is not a time ("We're six, and later." put 13–28 % of
 * the Time mass on 18:00 without it). A direction with no option at all (the last or first chip) gets
 * a sentinel criterion instead: tying both directions to one target made "later" at 21:00 patch
 * 20:00 (9 backwards patches in 15 measured cases); the sentinel turns it into a partial edit.
 * Chips that stop short of one hour (20:00 selected, last chip 20:30) name the nearest option in
 * that direction: without a clause "We're six, and later." patched Guests only or composed (2 of 7
 * chip screens in the brick-catalog evals, both without a chip one hour on).
 */
/**
 * Date-only knobs change only on a named day. With "pick one day after" for a bare "later", a
 * separate Day knob claimed "We're six, and later." and moved the date (A/B run: 5/10 dinner misses).
 * With a time knob on screen, time words leave the date alone; without one, a "time" sentinel turns
 * them into a partial edit, so "later" composes instead of moving the date or being dropped.
 */
function dateHint(knob: ChoiceKnob, hasTimeKnob: boolean): { text: string; sentinels: Record<string, string> } {
  const sentinels: Record<string, string> = {};
  let text = " Only a named day changes the date (such as 'on Friday', 'tomorrow' or 'the day after').";
  const cur = typeof knob.current === "string" ? knob.current.slice(0, 10) : "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(cur)) {
    const [y, m, d] = cur.split("-").map(Number);
    const next = isoDate(new Date(y, m - 1, d + 1));
    const dayAfter = knob.options.find((o) => String(o.value).startsWith(next));
    if (dayAfter) text += " If the speaker says the day after, pick " + dayAfter.key + ".";
  }
  if (hasTimeKnob) {
    text += " Later, earlier or a time of day alone leave the date unchanged.";
  } else if (!knob.options.some((o) => o.key === "time")) {
    sentinels.time = "A time of day, or just later or earlier, which this screen cannot set";
    // "even when a day is named too": without it "Friday at nine" patched the date and dropped the nine.
    text += " If the request mentions any time of day (such as 'at nine' or 'half past seven') or says later or earlier, pick time, even when a day is named too.";
  }
  return { text, sentinels };
}

function relativeHint(knob: ChoiceKnob, flavour: Flavour): { text: string; sentinels: Record<string, string> } {
  const sentinels: Record<string, string> = {};
  if (flavour !== "time") return { text: RELATIVE_HINT[flavour], sentinels };
  const count = " A count of people, such as 'we're six', is not a time.";
  const cur = minutesOf(knob.current);
  if (cur === null) return { text: " If the speaker only says later or earlier without a time, pick one hour later or earlier." + count, sentinels };
  const keys = new Set(knob.options.map((o) => o.key));
  // DateTimeInput slots wrap around midnight, so both directions always exist there; chips are linear.
  const circular = knob.component === "DateTimeInput";
  const mins = knob.options.map((o) => minutesOf(o.value)).filter((m): m is number => m !== null);
  let text = "";
  for (const dir of ["later", "earlier"] as const) {
    const target = hhmm((cur + (dir === "later" ? 60 : 1380)) % 1440);
    const any = circular || mins.some((m) => (dir === "later" ? m > cur : m < cur));
    const nearest = circular ? null : nearestOption(knob, cur, dir);
    if (keys.has(target)) {
      text += " If the speaker only says " + dir + " without a time, pick " + target + " (one hour " + dir + ").";
    } else if (nearest !== null) {
      text += " If the speaker only says " + dir + " without a time, pick " + nearest + " (the next " + dir + " time).";
    } else if (!any && !keys.has(dir)) {
      sentinels[dir] = (dir === "later" ? "Later" : "Earlier") + " than " + hhmm(cur) + ", which is not available";
      text += " If the speaker only says " + dir + ", pick " + dir + ".";
    }
  }
  return { text: text + count, sentinels };
}

/** Key of the option closest to `cur` strictly in one direction (linear chips), or null when there is none. */
function nearestOption(knob: ChoiceKnob, cur: number, dir: "later" | "earlier"): string | null {
  let best: { key: string; m: number } | null = null;
  for (const o of knob.options) {
    const m = minutesOf(o.value);
    if (m === null || (dir === "later" ? m <= cur : m >= cur)) continue;
    if (best === null || (dir === "later" ? m < best.m : m > best.m)) best = { key: o.key, m };
  }
  return best ? best.key : null;
}

function minutesOf(v: JsonValue): number | null {
  const s = Array.isArray(v) ? v[0] : v;
  if (typeof s !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

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
  if (!Object.hasOwn(obj, key)) return key;
  for (let n = 2; ; n++) if (!Object.hasOwn(obj, key + " (" + n + ")")) return key + " (" + n + ")";
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
  const guard = noul(answers[GUARD_QUESTION]);
  if (guard !== null && guard >= GUARD_THRESHOLD) return compose("edit", kindConfidence, "asks for something not on screen");

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

type Pick =
  | { status: "unchanged" }
  | { status: "partial"; sentinel: string | null }
  | { status: "changed"; option: KnobOption; p: number };

function pickOption(options: KnobOption[], ans: JevAnswer | undefined, threshold: number): Pick {
  if (!ans || ans.type !== "choice") return { status: "unchanged" };
  const probs = ans.probabilities;
  const pUnchanged = probs[UNCHANGED] ?? 0;
  let best: KnobOption | null = null;
  let bestP = -1;
  for (const o of options) {
    const p = probs[o.key];
    if (typeof p === "number" && p > bestP) {
      best = o;
      bestP = p;
    }
  }
  const top = argmax(probs);
  // Speaker asked to change it (low P(unchanged), or a change is the top answer) but no option is clear.
  const askedToChange = pUnchanged < 1 - threshold || (top !== null && top !== UNCHANGED);
  if (best === null || bestP < threshold) {
    if (!askedToChange) return { status: "unchanged" };
    // A sentinel ("later" past the last chip) is not an option: name it so the inspector says why.
    const sentinel = top !== null && top !== UNCHANGED && !options.some((o) => o.key === top) ? top : null;
    return { status: "partial", sentinel };
  }
  if (top === UNCHANGED) return { status: "unchanged" };
  return { status: "changed", option: best, p: bestP };
}

function knobOutcome(knob: Knob, index: number, answers: JevAnswers): KnobOutcome {
  const threshold = LIMITS.routeKnobThreshold;
  if (knob.type === "choice" && isDateTimeKnob(knob)) {
    const { dates, times } = splitDateTime(knob);
    const d = pickOption(dates, answers[knobQuestionId(index)], threshold);
    const t = pickOption(times, answers[knobTimeQuestionId(index)], threshold);
    if (d.status === "partial") return { status: "partial", label: knob.label + " (date)" };
    if (t.status === "partial") return { status: "partial", label: knob.label + " (time)" };
    if (d.status === "unchanged" && t.status === "unchanged") return { status: "unchanged" };
    let value: string;
    if (d.status === "changed" && t.status === "changed") value = String(d.option.value).slice(0, 10) + "T" + t.option.key;
    else if (t.status === "changed") value = String(t.option.value);
    else if (d.status === "changed") value = String(d.option.value);
    else return { status: "unchanged" };
    const parts = [d.status === "changed" ? d.option.key : null, t.status === "changed" ? t.option.key : null].filter(Boolean);
    const confidence = Math.min(d.status === "changed" ? d.p : 1, t.status === "changed" ? t.p : 1);
    return {
      status: "changed",
      patch: { knobId: knob.id, path: knob.path, value, confidence },
      display: knob.label + " → " + parts.join(" "),
    };
  }
  if (knob.type === "choice") {
    const pick = pickOption(knob.options, answers[knobQuestionId(index)], threshold);
    if (pick.status === "unchanged") return { status: "unchanged" };
    if (pick.status === "partial") return { status: "partial", label: knob.label + (pick.sentinel ? " (no " + pick.sentinel + " option)" : "") };
    return {
      status: "changed",
      patch: { knobId: knob.id, path: knob.path, value: pick.option.value, confidence: pick.p },
      display: knob.label + " → " + pick.option.key,
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
