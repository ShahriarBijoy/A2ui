/**
 * Live evaluation of the decision model against Jev (needs network + a key).
 *   bun run scripts/jev-eval.ts
 * Uses the shipped code paths: deriveKnobs → route() (800 ms budget) and predictBricks().
 * A fetch tap records the raw Jev answers so failures can be explained.
 */
import { readFileSync } from "node:fs";
import type { CatalogComponent, JsonValue } from "../src/shared/a2ui";
import { buildRouteRequest, deriveKnobs, GUARD_THRESHOLD } from "../src/shared/knobs";
import type { JevAnswers } from "../src/shared/knobs";
import type { Knob, RouteResult, TurnRequest } from "../src/shared/protocol";
import { decide, warmJev } from "../src/worker/jev";
import type { JevEnv } from "../src/worker/jev";
import { predictBricks } from "../src/worker/predict";
import { BRICKS } from "../src/shared/catalog";
import { route } from "../src/worker/router";

function devVar(name: string): string | undefined {
  try {
    const line = readFileSync(new URL("../.dev.vars", import.meta.url), "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith(name + "="));
    return line?.slice(name.length + 1).trim() || undefined;
  } catch {
    return undefined;
  }
}

const key = process.env.JEV_API_KEY || process.env.TYPESAFE_API_KEY || devVar("JEV_API_KEY");
if (!key) {
  console.error("No JEV_API_KEY / TYPESAFE_API_KEY in the environment or .dev.vars");
  process.exit(1);
}
const env: JevEnv = {
  JEV_URL: process.env.JEV_URL || "https://api.typesafe.ai/v1/systemone",
  JEV_API_KEY: key,
  JEV_MODEL: process.env.JEV_MODEL || "jev-latest",
};

// ── fetch tap: keep the last Jev response body ───────────────────────────────
const realFetch = globalThis.fetch;
let lastBody: { answers?: JevAnswers; usage?: { input_tokens: number } } | null = null;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  lastBody = null;
  const res = await realFetch(input, init);
  try {
    lastBody = await res.clone().json();
  } catch {
    lastBody = null;
  }
  return res;
}) as typeof fetch;

const now = new Date();
const iso = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const day = (offset: number) => iso(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
const nextWeekday = (wd: number) => {
  for (let i = 1; i <= 7; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    if (d.getDay() === wd) return iso(d);
  }
  return "";
};

function turn(components: CatalogComponent[], data: JsonValue, text: string): { req: TurnRequest; knobs: Knob[] } {
  const knobs = deriveKnobs(components, data, now);
  return {
    knobs,
    req: { mode: "a2ui", decision: true, input: { type: "utterance", text }, thread: [], surface: { id: "s", components: [], data, knobs }, nextSurfaceId: "s2" },
  };
}

/**
 * compose: optionally the exact reason, or guard: the guard Noul itself must be ≥ the threshold
 * (another rule may compose first, e.g. "unsure it is an edit"; this still proves the guard fires).
 * patches: orCompose accepts a compose too (e.g. "later" at 20:30, where one hour later is no chip).
 */
type Expect =
  | { compose: true; reason?: string; guard?: true }
  | { patches: Record<string, JsonValue[]>; orCompose?: true };

function check(r: RouteResult, exp: Expect): boolean {
  if ("compose" in exp) {
    if (r.decision !== "compose") return false;
    if (exp.reason !== undefined && r.reason !== exp.reason) return false;
    if (exp.guard) {
      const g = lastBody?.answers?.guard;
      if (g?.type !== "noul" || g.noul < GUARD_THRESHOLD) return false;
    }
    return true;
  }
  if (r.decision !== "patch") return exp.orCompose === true && r.decision === "compose";
  const got = new Map(r.patches.map((p) => [p.path, JSON.stringify(p.value)]));
  const want = Object.entries(exp.patches);
  if (got.size !== want.length) return false;
  return want.every(([path, ok]) => ok.some((v) => JSON.stringify(v) === got.get(path)));
}

/** Top-2 of each knob answer, for the failure log. */
function detail(knobs: Knob[], answers: JevAnswers | undefined): string {
  if (!answers) return "";
  const parts: string[] = [];
  const kind = answers.kind;
  if (kind?.type === "choice") parts.push("kind " + top(kind.probabilities));
  knobs.forEach((k, i) => {
    if (k.type === "choice") {
      const a = answers["k" + i];
      const t = answers["k" + i + "t"];
      if (a?.type === "choice") parts.push(k.label + (t ? " date " : " ") + top(a.probabilities));
      if (t?.type === "choice") parts.push(k.label + " time " + top(t.probabilities));
    } else if (k.type === "bool") {
      const a = answers["k" + i];
      if (a?.type === "noul") parts.push(k.label + " noul " + a.noul.toFixed(2));
    } else {
      k.options.forEach((o, j) => {
        const a = answers["k" + i + "_" + j];
        if (a?.type === "noul") parts.push(o.label + " noul " + a.noul.toFixed(2));
      });
    }
  });
  const guard = answers.guard;
  if (guard?.type === "noul") parts.push("guard " + guard.noul.toFixed(2));
  return parts.join(" | ");
}
function top(p: Record<string, number>): string {
  return Object.entries(p)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => k + "@" + v.toFixed(2))
    .join(" ");
}
function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const routeMs: number[] = [];
let fails = 0;

async function runLine(components: CatalogComponent[], data: JsonValue, text: string, exp: Expect) {
  const { req, knobs } = turn(components, data, text);
  const r = await route(req, env);
  routeMs.push(r.ms);
  const ok = check(r, exp);
  if (!ok) fails++;
  const patches = r.patches.map((p) => p.path.split("/").pop() + "=" + JSON.stringify(p.value)).join(" ");
  console.log(
    (ok ? "PASS " : "FAIL ") + JSON.stringify(text).padEnd(40) + " " + r.decision.padEnd(7) + " " + String(r.ms).padStart(4) + " ms  " +
      (patches ? "[" + patches + "] " : "") + "· " + r.reason,
  );
  console.log("       " + detail(knobs, lastBody?.answers) + (r.inputTokens ? " | in " + r.inputTokens + " tok" : ""));
}

// ── warm-up via warmJev (cold number, reported separately) ─────────────────────
{
  const cold = await warmJev(env);
  const { req } = turn(
    [{ id: "g", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/g" } }],
    { g: 4 },
    "make it five",
  );
  const first = await route(req, env);
  console.log("warmJev (cold connection, GET /v1/models): " + cold + " ms; first route() after it: " + first.ms + " ms (" + first.decision + ")\n");
}

// ── 1. Dinner screen ─────────────────────────────────────────────────────────
const dinner: CatalogComponent[] = [
  {
    id: "time",
    component: "ChoicePicker",
    label: "Time",
    variant: "mutuallyExclusive",
    options: ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"].map((t) => ({ label: t, value: t })),
    value: { "@path": "/booking/time" },
  },
  { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/booking/guests" } },
];
const dinnerData: JsonValue = { booking: { place: "Placeholder Bistro", time: ["19:00"], guests: 4 } };
const G = "/booking/guests";
const T = "/booking/time";
const dinnerLines: [string, Expect][] = [
  ["we're six, and later", { patches: { [G]: [6], [T]: [["20:00"]] } }],
  ["make it eight people", { patches: { [G]: [8] } }],
  ["at nine pm please", { patches: { [T]: [["21:00"]] } }],
  ["two more people", { patches: { [G]: [6] } }],
  ["just the two of us, a bit earlier", { patches: { [G]: [2], [T]: [["18:00"]] } }],
  ["can we do half past seven", { patches: { [T]: [["19:30"]] } }],
  ["book it", { compose: true }],
  ["what about Italian?", { compose: true }],
  ["actually I need a flight instead", { compose: true }],
  ["sounds good", { compose: true }],
  ["confirm", { compose: true }],
  ["hmm let me think", { compose: true }],
  // Mixed: a knob plus something the knobs cannot express → must not patch half of it.
  ["somewhere closer, and later", { compose: true, guard: true }],
  ["a different place for six people", { compose: true }],
  // Transcription variants of the 1:10 beat.
  ["We're 6, and later.", { patches: { [G]: [6], [T]: [["20:00"]] } }],
  ["we are six and later", { patches: { [G]: [6], [T]: [["20:00"]] } }],
  ["We're six. And later.", { patches: { [G]: [6], [T]: [["20:00"]] } }],
];
console.log("1. Dinner screen (Time chips [19:00], Guests stepper 4)");
for (const [text, exp] of dinnerLines) await runLine(dinner, dinnerData, text, exp);

// ── 2. Flight screen ─────────────────────────────────────────────────────────
const flight: CatalogComponent[] = [
  { id: "from", component: "TextField", label: "From", value: { "@path": "/flight/from" } },
  { id: "to", component: "TextField", label: "To", value: { "@path": "/flight/to" } },
  { id: "date", component: "DateTimeInput", label: "Date", enableDate: true, value: { "@path": "/flight/date" } },
  { id: "ret", component: "CheckBox", label: "Return flight", value: { "@path": "/flight/return" } },
];
const flightData: JsonValue = { flight: { from: "Bremen", to: "", date: day(1), return: false } };
const D = "/flight/date";
const flightLines: [string, Expect][] = [
  ["make it the day after", { patches: { [D]: [day(2)] } }],
  ["actually on friday", { patches: { [D]: [nextWeekday(5)] } }],
  ["I need a return flight too", { patches: { "/flight/return": [true] } }],
  ["to New York, give me options", { compose: true }],
  ["to New York on friday", { compose: true }],
  ["from Hamburg instead", { compose: true }],
];
console.log("\n2. Flight screen (From/To text fields, Date = tomorrow " + day(1) + ", Return off)");
for (const [text, exp] of flightLines) await runLine(flight, flightData, text, exp);

console.log(
  "\nroute latency over " + routeMs.length + " warm calls: median " + median(routeMs) + " ms, max " + Math.max(...routeMs) +
    " ms, over 800 ms: " + routeMs.filter((m) => m > 800).length + "; route failures: " + fails,
);

// ── 3. Prediction ────────────────────────────────────────────────────────────
const sentence = "I need to book a flight and choose my seat";
const words = sentence.split(" ");
const prefixes = [3, 5, 7, words.length].map((n) => words.slice(0, n).join(" "));
const predictMs: number[] = [];
const LAYOUT = new Set<string>(BRICKS.filter((b) => b.group === "layout").map((b) => b.name));
console.log("\n3. Brick prediction (3 rounds per prefix)");
await predictBricks("warm up", env);
for (let round = 0; round < 3; round++) {
  for (const p of prefixes) {
    const r = await predictBricks(p, env);
    predictMs.push(r.ms);
    if (round > 0) continue;
    const b = r.bricks;
    const onList = Object.entries(b)
      .filter(([, v]) => (v ?? 0) >= 0.6)
      .map(([k]) => k);
    const nonLayout = onList.filter((n) => !LAYOUT.has(n)).length;
    const on = onList.length + " (" + nonLayout + " non-layout): " + onList.join(", ");
    console.log(
      JSON.stringify(p).padEnd(46) + " SeatMap " + (b.SeatMap ?? 0).toFixed(2) + "  OptionCard " + (b.OptionCard ?? 0).toFixed(2) +
        "  DateTimeInput " + (b.DateTimeInput ?? 0).toFixed(2) + "  " + String(r.ms).padStart(4) + " ms  ≥0.6: " + (on || "none") + "  (" + r.engine + ")",
    );
  }
}
console.log("predict latency over " + predictMs.length + " warm calls: median " + median(predictMs) + " ms, max " + Math.max(...predictMs) + " ms");

// ── 4. Multi-select picker + checkbox, through route() ───────────────────────
const diet: CatalogComponent[] = [
  {
    id: "diet",
    component: "ChoicePicker",
    label: "Diet",
    variant: "multipleSelection",
    options: [
      { label: "Vegan", value: "vegan" },
      { label: "Vegetarian", value: "veg" },
      { label: "Gluten free", value: "gf" },
    ],
    value: { "@path": "/diet" },
  },
  { id: "kids", component: "CheckBox", label: "Kids menu", value: { "@path": "/kids" } },
];
const dietData: JsonValue = { diet: ["veg"], kids: false };
const dietLines: [string, Expect][] = [
  ["add gluten free", { patches: { "/diet": [["veg", "gf"]] } }],
  ["actually make it vegan too", { patches: { "/diet": [["vegan", "veg"]] } }],
  ["no longer vegetarian", { patches: { "/diet": [[]] } }],
  ["drop the vegetarian, add vegan", { patches: { "/diet": [["vegan"]] } }],
  ["and the kids menu please", { patches: { "/kids": [true] } }],
  ["we're bringing two kids", { compose: true }],
  ["book it", { compose: true }],
];
console.log("\n4. Diet chips (multi, Vegetarian on) + Kids menu checkbox (off)");
const before4 = routeMs.length;
for (const [text, exp] of dietLines) await runLine(diet, dietData, text, exp);
console.log("section 4 route latency: median " + median(routeMs.slice(before4)) + " ms; total route failures so far: " + fails);

// ── 5. Time knob size: ±6 h window vs all half-hour slots ────────────────────
console.log("\n5. DateTimeInput time knob: ±6 h window vs full day ('a bit later', current 19:00)");
const timeInput: CatalogComponent[] = [
  { id: "t", component: "DateTimeInput", label: "Time", enableTime: true, enableDate: false, value: { "@path": "/t" } },
];
const windowKnobs = deriveKnobs(timeInput, { t: "19:00" }, now);
const fullKnobs: Knob[] = windowKnobs.map((k) => {
  if (k.type !== "choice") return k;
  const options = [];
  for (let m = 0; m < 1440; m += 30) {
    const hh = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
    const diff = m - 19 * 60;
    const abs = Math.abs(diff);
    const h = Math.floor(abs / 60);
    const mm = abs % 60;
    const rel = (h && mm ? h + " h " + mm + " min" : h ? h + " h" : mm + " min") + (diff > 0 ? " later" : " earlier");
    if (hh !== "19:00") options.push({ key: hh, label: hh + " (" + rel + ")", value: hh });
  }
  return { ...k, options };
});
for (const [name, knobs] of [["window", windowKnobs], ["full", fullKnobs]] as const) {
  const ms: number[] = [];
  let summary = "";
  for (let i = 0; i < 3; i++) {
    const { state, questions } = buildRouteRequest("a bit later please", knobs);
    const res = await decide(env, state, questions, { timeoutMs: 3000 });
    ms.push(res.ms);
    const a = res.answers.k0;
    summary = "in " + res.usage.input_tokens + " tok, " + (a?.type === "choice" ? top(a.probabilities) : "?");
  }
  const opts = knobs[0].type === "choice" ? knobs[0].options.length : 0;
  console.log(name.padEnd(7) + String(opts).padStart(3) + " options  median " + median(ms) + " ms  " + summary);
}

// ── 6. SeatMap, through route() ──────────────────────────────────────────────
const seatMap: CatalogComponent[] = [
  {
    id: "seat",
    component: "SeatMap",
    rows: 30,
    layout: "ABC DEF",
    taken: ["1A", "1B", "3C", "5F", "7D", "10A", "12A", "12B", "14E", "20C"],
    value: { "@path": "/seat" },
  },
];
console.log("\n6. SeatMap 30 x ABC DEF, 10 taken, no seat selected");
const seatLines: [string, Expect][] = [
  ["seat 12C please", { patches: { "/seat": ["12C"] } }],
  ["a window seat", { compose: true }],
  ["book it", { compose: true }],
];
for (const [text, exp] of seatLines) await runLine(seatMap, { seat: "" }, text, exp);

// ── 7. Time-only DateTimeInput (what the composer built in the smoke run) ─────
const timeOnly: CatalogComponent[] = [
  { id: "time", component: "DateTimeInput", label: "Time", enableTime: true, enableDate: false, value: { "@path": "/booking/time" } },
  { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/booking/guests" } },
];
const timeLines: [string, string, Expect][] = [
  ["19:00", "We're six, and later.", { patches: { [G]: [6], [T]: ["20:00"] } }],
  ["19:00", "later please", { patches: { [T]: ["20:00"] } }],
  ["19:00", "a bit later", { patches: { [T]: ["20:00"] } }],
  ["19:00", "half an hour later", { patches: { [T]: ["19:30"] } }],
  ["19:00", "at nine", { patches: { [T]: ["21:00"] } }],
  ["19:00", "book it", { compose: true }],
  // Late clock (the smoke run was at 22:36): "later" must be able to cross midnight.
  ["22:30", "We're six, and later.", { patches: { [G]: [6], [T]: ["23:30"] } }],
  ["23:00", "We're six, and later.", { patches: { [G]: [6], [T]: ["00:00"] } }],
  ["23:00", "at nine", { patches: { [T]: ["21:00"] } }],
];
console.log("\n7. Time-only DateTimeInput + Guests stepper 4");
for (const [cur, text, exp] of timeLines) {
  process.stdout.write("[" + cur + "] ");
  await runLine(timeOnly, { booking: { time: cur, guests: 4 } }, text, exp);
}

// ── 8. Date-only DateTimeInput ────────────────────────────────────────────────
const dateOnly: CatalogComponent[] = [
  { id: "date", component: "DateTimeInput", label: "Date", enableDate: true, enableTime: false, value: { "@path": "/trip/date" } },
  { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/trip/guests" } },
];
const dateLines: [string, Expect][] = [
  ["the day after", { patches: { "/trip/date": [day(2)] } }],
  ["make it the day after", { patches: { "/trip/date": [day(2)] } }],
  ["on Friday", { patches: { "/trip/date": [nextWeekday(5)] } }],
  ["book it", { compose: true }],
];
console.log("\n8. Date-only DateTimeInput (tomorrow " + day(1) + ") + Guests stepper 2");
for (const [text, exp] of dateLines) await runLine(dateOnly, { trip: { date: day(1), guests: 2 } }, text, exp);

// ── 9. Guests only: nothing else on screen must not be silently dropped ──────
const guestsOnly: CatalogComponent[] = [
  { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/booking/guests" } },
];
const guestLines: [string, Expect][] = [
  ["We're six, and later.", { compose: true, reason: "asks for something not on screen" }],
  ["make it six and add a dessert option", { compose: true, guard: true }],
  ["make it six", { patches: { [G]: [6] } }],
  ["two more people", { patches: { [G]: [6] } }],
];
console.log("\n9. Guests stepper only (4)");
for (const [text, exp] of guestLines) await runLine(guestsOnly, { booking: { guests: 4 } }, text, exp);

// ── 10. Time chips at the edges of their range (18:00..21:00) ────────────────
// "later" on the last chip must never patch an earlier time; it composes (sentinel → partial edit).
const edgeLines: [string, string, Expect][] = [
  ["21:00", "later", { compose: true, reason: "partial edit: Time (no later option)" }],
  ["21:00", "a bit later", { compose: true }],
  ["21:00", "We're six, and later.", { compose: true }],
  ["21:00", "earlier", { patches: { [T]: [["20:00"]] } }],
  ["18:00", "earlier", { compose: true, reason: "partial edit: Time (no earlier option)" }],
  ["18:00", "We're six, and earlier.", { compose: true }],
  ["18:00", "a bit later", { patches: { [T]: [["19:00"]] } }],
  ["20:30", "later", { patches: { [T]: [["21:00"]] }, orCompose: true }],
  ["18:30", "earlier", { patches: { [T]: [["18:00"]] }, orCompose: true }],
  ["20:00", "later", { patches: { [T]: [["21:00"]] } }],
  ["19:00", "earlier", { patches: { [T]: [["18:00"]] } }],
];
console.log("\n10. Time chips at the edges (18:00..21:00) + Guests stepper 4");
for (const [cur, text, exp] of edgeLines) {
  process.stdout.write("[" + cur + "] ");
  await runLine(dinner, { booking: { place: "Placeholder Bistro", time: [cur], guests: 4 } }, text, exp);
}

// ── 11. Date + time in one DateTimeInput (talk-clock smoke run) ───────────────
// "later" must change the time on the same date; only a named day changes the date.
const both: CatalogComponent[] = [
  { id: "when", component: "DateTimeInput", label: "Date and time", enableDate: true, enableTime: true, value: { "@path": "/booking/when" } },
  { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/booking/guests" } },
];
const fri = nextWeekday(5);
const base2 = day(2) === fri ? day(3) : day(2);
const plus1 = (isoDay: string) => {
  const [y, m, d] = isoDay.split("-").map(Number);
  return iso(new Date(y, m - 1, d + 1));
};
const W = "/booking/when";
const bothLines: [string, string, Expect][] = [
  ["19:00", "We're six, and later.", { patches: { [G]: [6], [W]: [base2 + "T20:00"] } }],
  ["19:00", "later", { patches: { [W]: [base2 + "T20:00"] } }],
  ["19:00", "make it Friday", { patches: { [W]: [fri + "T19:00"] } }],
  ["19:00", "at nine on Friday", { patches: { [W]: [fri + "T21:00"] } }],
  ["19:00", "at nine", { patches: { [W]: [base2 + "T21:00"] } }],
  ["19:00", "half past seven", { patches: { [W]: [base2 + "T19:30"] } }],
  ["19:00", "the day after", { patches: { [W]: [plus1(base2) + "T19:00"] } }],
  ["19:00", "book it", { compose: true }],
  ["23:00", "later", { patches: { [W]: [plus1(base2) + "T00:00"] } }],
];
console.log("\n11. Date + time DateTimeInput (" + base2 + ") + Guests stepper 4");
for (const [time, text, exp] of bothLines) {
  process.stdout.write("[" + time + "] ");
  await runLine(both, { booking: { when: base2 + "T" + time, guests: 4 } }, text, exp);
}

// ── 12–14. A separate date-only "Day" knob (Sonnet often builds one next to a time control) ──
// Only a named day moves the Day; time words go to the time knob, or compose when there is none.
const dayKnob: CatalogComponent = { id: "day", component: "DateTimeInput", label: "Day", enableDate: true, value: { "@path": "/booking/day" } };
const guestsKnob: CatalogComponent = { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/booking/guests" } };
const timeChips: CatalogComponent = {
  id: "time",
  component: "ChoicePicker",
  label: "Time",
  variant: "mutuallyExclusive",
  options: ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"].map((t) => ({ label: t, value: t })),
  value: { "@path": "/booking/time" },
};
const timeOnlyKnob: CatalogComponent = { id: "time", component: "DateTimeInput", label: "Time", enableTime: true, enableDate: false, value: { "@path": "/booking/time" } };
const DAY = "/booking/day";
const dayScreens: [string, CatalogComponent[], JsonValue, [string, Expect][]][] = [
  ["12. Day (date-only) + Time chips + Guests", [dayKnob, timeChips, guestsKnob], { booking: { day: base2, time: ["19:00"], guests: 4 } }, [
    ["We're six, and later.", { patches: { [G]: [6], [T]: [["20:00"]] } }],
    ["make it Friday", { patches: { [DAY]: [fri] } }],
    ["at nine on Friday", { patches: { [DAY]: [fri], [T]: [["21:00"]] } }],
    ["later", { patches: { [T]: [["20:00"]] } }],
    ["the day after", { patches: { [DAY]: [plus1(base2)] } }],
  ]],
  ["13. Day (date-only) + Time (time-only input) + Guests", [dayKnob, timeOnlyKnob, guestsKnob], { booking: { day: base2, time: "19:00", guests: 4 } }, [
    ["We're six, and later.", { patches: { [G]: [6], [T]: ["20:00"] } }],
    ["make it Friday", { patches: { [DAY]: [fri] } }],
    ["at nine on Friday", { patches: { [DAY]: [fri], [T]: ["21:00"] } }],
    ["later", { patches: { [T]: ["20:00"] } }],
  ]],
  ["14. Day (date-only) + Guests, no time control", [dayKnob, guestsKnob], { booking: { day: base2, guests: 4 } }, [
    ["We're six, and later.", { compose: true }],
    ["make it Friday", { patches: { [DAY]: [fri] } }],
    ["at nine on Friday", { compose: true }],
    ["Friday at nine", { compose: true }],
    ["later", { compose: true }],
    ["the day after", { patches: { [DAY]: [plus1(base2)] } }],
  ]],
];
for (const [title, comps, data, lines] of dayScreens) {
  console.log("\n" + title + " (Day " + base2 + ")");
  for (const [text, exp] of lines) await runLine(comps, data, text, exp);
}

globalThis.fetch = realFetch;
console.log("\nroute failures (all sections): " + fails);
if (fails > 0) process.exit(1);
