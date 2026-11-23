/**
 * Live evaluation of the decision model against Jev (needs network + a key).
 *   bun run scripts/jev-eval.ts
 * Uses the shipped code paths: deriveKnobs → route() (800 ms budget) and predictBricks().
 * A fetch tap records the raw Jev answers so failures can be explained.
 */
import { readFileSync } from "node:fs";
import type { CatalogComponent, JsonValue } from "../src/shared/a2ui";
import { buildRouteRequest, deriveKnobs } from "../src/shared/knobs";
import type { JevAnswers } from "../src/shared/knobs";
import type { Knob, RouteResult, TurnRequest } from "../src/shared/protocol";
import { decide } from "../src/worker/jev";
import type { JevEnv } from "../src/worker/jev";
import { predictBricks } from "../src/worker/predict";
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

type Expect = { compose: true } | { patches: Record<string, JsonValue[]> };

function check(r: RouteResult, exp: Expect): boolean {
  if ("compose" in exp) return r.decision === "compose";
  if (r.decision !== "patch") return false;
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
      if (a?.type === "choice") parts.push(k.label + " " + top(a.probabilities));
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

// ── warm-up (cold number, reported separately) ───────────────────────────────
{
  const t0 = Date.now();
  await decide(env, { text: "hello" }, { q: { type: "noul", instructions: "Is this a greeting?" } }, { timeoutMs: 5000 });
  console.log("warm-up (cold connection): " + (Date.now() - t0) + " ms\n");
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
  ["just the two of us, a bit earlier", { patches: { [G]: [2], [T]: [["18:00"], ["18:30"]] } }],
  ["can we do half past seven", { patches: { [T]: [["19:30"]] } }],
  ["book it", { compose: true }],
  ["what about Italian?", { compose: true }],
  ["actually I need a flight instead", { compose: true }],
  ["sounds good", { compose: true }],
  ["confirm", { compose: true }],
  ["hmm let me think", { compose: true }],
  // Mixed: a knob plus something the knobs cannot express → must not patch half of it.
  ["somewhere closer, and later", { compose: true }],
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
console.log("\n3. Brick prediction (3 rounds per prefix)");
await predictBricks("warm up", env);
for (let round = 0; round < 3; round++) {
  for (const p of prefixes) {
    const r = await predictBricks(p, env);
    predictMs.push(r.ms);
    if (round > 0) continue;
    const b = r.bricks;
    const on = Object.entries(b)
      .filter(([, v]) => (v ?? 0) >= 0.6)
      .map(([k]) => k)
      .join(", ");
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
    if (hh !== "19:00") options.push({ key: hh, label: hh, value: hh });
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

globalThis.fetch = realFetch;
