/**
 * Step 13 smoke run (PLAN §8): every scenario in src/shared/scenarios.ts plus the held-out lines (HELD_OUT),
 * driven through the real client code (store, turn client, A2UI processor, knobs) against a running
 * Brick Box, by default the deployed one.
 *   bun run smoke [baseUrl] [--runs 3] [--only dinner,flight,heldout] [--out scripts/smoke-results.md] [--raw dir] [--note "..."] [--strict]
 * DEMO_KEY comes from the environment or .dev.vars and is never printed.
 *
 * a2ui runs every scenario (all steps) and every held-out line --runs times; widgets and html run each
 * scenario's opening line once, in the modes the scenario lists.
 * A line passes when: at least one component rendered (widgets: a widget or text; html: a page),
 * no refused components and no validation errors from the real processor, at most 7 visible blocks,
 * no error, and on a step that expects OptionCards, at least one OptionCard drawn by a List from data with a
 * non-empty title (an empty list, "Nothing found" or a failed search fails the step). --strict also fails a step
 * whose expected bricks or data are missing (otherwise they are only noted). A patch step ("We're six, and later.", see PATCH_EXPECT) is judged by its result: on a screen with a
 * people count and a time control that has a later time on the same date, the route must patch with no usage event
 * (no LLM call), the count must be 6, one time control must move later on the same date, and no other data value
 * may change. On a screen without such a time control (or count) the route must compose: a patch there dropped part
 * of the line ("later dropped"). Before/after values and the route reason are printed for every run.
 * Visible block (controller ruling): a top-level visual unit inside the root container. The root is
 * unwrapped through Cards, single-child Columns and the first tab; each child of the main Column is one
 * block, whatever it holds (a label/value Row, a List, a nested Column or Card, a Button).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { A2uiMessage, Action, CheckRule, JsonObject, JsonValue } from "@shared/a2ui";
import { isChildTemplate, isPlainObject } from "@shared/a2ui";
import { deriveKnobs } from "@shared/knobs";
import { formatPointer, getAt } from "@shared/pointer";
import type { Knob, Mode, TurnEvent, TurnRequest } from "@shared/protocol";
import { SCENARIOS, type ScenarioExpect, type ScenarioStep } from "@shared/scenarios";
import { evalChecks, resolve, toText } from "../src/client/a2ui/evaluate";
import { templateState } from "../src/client/a2ui/template";
import type { AgentItem, ComponentEntry, StoreApi, SurfaceState } from "../src/client/state";
import { createStore } from "../src/client/store";
import { createTurnClient } from "../src/client/turns";

const DEFAULT_URL = "https://brick-box.shahriarbijoy.workers.dev";
const MAX_BLOCKS = 7;

/**
 * The held-out lines exist only as summaries in lane-W-report.md; this wording is reconstructed and
 * matches scripts/live-search.ts (imported by copy, since importing that script would run it).
 */
const HELD_OUT: readonly { id: string; title: string; say: string; weather?: true }[] = [
  { id: "lisbon", title: "Held-out: Lisbon trip", say: "Plan a 3-day trip to Lisbon in March." },
  { id: "phones", title: "Held-out: phone plans", say: "Compare two phone plans for me." },
  { id: "dog", title: "Held-out: adopt a dog", say: "I want to adopt a dog. What do I need?" },
  { id: "gift", title: "Held-out: gift for mum", say: "Find a gift for my mum, around 50 euros." },
  { id: "haircut", title: "Held-out: haircut Saturday", say: "Book a haircut for Saturday morning." },
  // Added with the ten new bricks (2026-11-24): test inputs only, never prompt text.
  { id: "plans3", title: "Held-out: three cheapest plans", say: "Compare the three cheapest mobile phone plans in Germany." },
  { id: "hamburg", title: "Held-out: Saturday in Hamburg", say: "Plan a Saturday in Hamburg for two of us, with times." },
  { id: "cafe", title: "Held-out: café with photo", say: "Show me a nice café near the venue with a photo and its rating." },
  // Added with the weather data source (2026-11-24): test inputs only, never prompt text. Judged by weatherCheck too.
  { id: "weather-today", title: "Held-out: weather today", say: "What's the weather in Bremen today?", weather: true },
  { id: "weather-weekend", title: "Held-out: rain this weekend", say: "Will it rain in Hamburg this weekend?", weather: true },
];

// ── CLI ───────────────────────────────────────────────────────────────────────

type Options = { baseUrl: string; runs: number; only: Set<string> | null; out: string; raw: string | null; note: string | null; strict: boolean };

function parseArgs(argv: string[]): Options {
  const opts: Options = { baseUrl: DEFAULT_URL, runs: 3, only: null, out: join("scripts", "smoke-results.md"), raw: null, note: null, strict: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--runs") opts.runs = Math.max(1, Math.round(Number(next())) || 1);
    else if (a === "--only") opts.only = new Set(next().split(",").map((s) => s.trim()).filter(Boolean));
    else if (a === "--out") opts.out = next();
    else if (a === "--raw") opts.raw = next();
    else if (a === "--note") opts.note = next();
    else if (a === "--strict") opts.strict = true;
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.baseUrl = a.replace(/\/+$/, "");
  }
  return opts;
}

function demoKey(): string {
  const fromEnv = process.env.DEMO_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (existsSync(".dev.vars")) {
    for (const line of readFileSync(".dev.vars", "utf8").split(/\r?\n/)) {
      const m = /^DEMO_KEY\s*=\s*"?(.*?)"?\s*$/.exec(line);
      if (m?.[1]) return m[1];
    }
  }
  throw new Error("DEMO_KEY not found: set the DEMO_KEY env var or add it to .dev.vars");
}

// ── Jobs ──────────────────────────────────────────────────────────────────────

/** needs "weather": the line passes only if weather data arrived (weatherCheck). */
type Job = { id: string; title: string; group: string; mode: Mode; steps: ScenarioStep[]; runs: number; needs?: "weather" };

function buildJobs(opts: Options): Job[] {
  const wanted = (id: string, group: string) => !opts.only || opts.only.has(id) || opts.only.has(group);
  const jobs: Job[] = [];
  for (const s of SCENARIOS) {
    if (wanted(s.id, s.group)) jobs.push({ id: s.id, title: s.title, group: s.group, mode: "a2ui", steps: s.steps, runs: opts.runs });
  }
  for (const h of HELD_OUT) {
    // "--only weather" selects the weather lines.
    if (!wanted(h.id, "heldout") && !(h.weather && opts.only?.has("weather"))) continue;
    jobs.push({ id: h.id, title: h.title, group: "heldout", mode: "a2ui", steps: [{ say: h.say }], runs: opts.runs, ...(h.weather ? { needs: "weather" as const } : {}) });
  }
  for (const mode of ["widgets", "html"] as const) {
    for (const s of SCENARIOS) {
      const first = s.steps[0];
      if (!s.modes.includes(mode) || !first || !("say" in first) || !wanted(s.id, s.group)) continue;
      jobs.push({ id: s.id, title: s.title, group: s.group, mode, steps: [{ say: first.say }], runs: 1 });
    }
  }
  return jobs;
}

// ── Surface inspection (render order, as the bricks draw it) ─────────────────

type Node = { id: string; entry: ComponentEntry; scope: string; inList: boolean };

function typeOf(entry: ComponentEntry): string {
  return entry.status === "ok" ? entry.def.component : entry.component;
}

function propsOf(entry: ComponentEntry): Record<string, unknown> {
  return entry.status === "ok" ? (entry.def as unknown as Record<string, unknown>) : {};
}

/** Components reachable from root, depth first, List and template items expanded over the data. */
function renderOrder(surface: SurfaceState): Node[] {
  const out: Node[] = [];
  const seen = new Set<string>();
  const visit = (id: string, scope: string, inList: boolean, depth: number): void => {
    const key = id + "@" + scope;
    if (depth > 64 || seen.has(key)) return;
    seen.add(key);
    const entry = surface.components[id];
    // Not arrived yet: the renderer shows a skeleton, nothing countable.
    if (!entry) return;
    out.push({ id, entry, scope, inList });
    const p = propsOf(entry);
    const children = (v: unknown, inL: boolean) => {
      if (Array.isArray(v)) {
        for (const c of v) if (typeof c === "string") visit(c, scope, inL, depth + 1);
      } else if (isChildTemplate(v)) {
        const st = templateState(v, surface.data, scope);
        if (st.kind === "items") for (const item of st.items) visit(v.componentId, item.scope, inL, depth + 1);
      }
    };
    switch (typeOf(entry)) {
      case "Card":
        if (typeof p.child === "string") visit(p.child, scope, inList, depth + 1);
        break;
      case "Column":
      case "Row":
        children(p.children, inList);
        break;
      case "List":
        children(p.children, true);
        break;
      case "Tabs": {
        const first = Array.isArray(p.tabs) ? p.tabs[0] : undefined;
        if (isPlainObject(first) && typeof first.child === "string") visit(first.child, scope, inList, depth + 1);
        break;
      }
      case "Accordion": {
        // The renderer opens the first section; the others are closed until tapped.
        const first = Array.isArray(p.items) ? p.items[0] : undefined;
        if (isPlainObject(first) && typeof first.child === "string") visit(first.child, scope, inList, depth + 1);
        break;
      }
      // A Button's child is its label; every other brick is a leaf.
    }
  };
  visit("root", "/", false, 0);
  return out;
}

/** Accepted components that no reference chain from root reaches (any tab, any Accordion section, any template, Button labels): never drawn. */
function orphans(surface: SurfaceState): string[] {
  const reached = new Set<string>();
  const stack = ["root"];
  while (stack.length) {
    const id = stack.pop() as string;
    if (reached.has(id)) continue;
    reached.add(id);
    const entry = surface.components[id];
    if (!entry) continue;
    const p = propsOf(entry);
    if (typeof p.child === "string") stack.push(p.child);
    if (Array.isArray(p.children)) for (const c of p.children) if (typeof c === "string") stack.push(c);
    if (isChildTemplate(p.children)) stack.push(p.children.componentId);
    if (Array.isArray(p.tabs)) for (const t of p.tabs) if (isPlainObject(t) && typeof t.child === "string") stack.push(t.child);
    if (typeOf(entry) === "Accordion" && Array.isArray(p.items)) {
      for (const t of p.items) if (isPlainObject(t) && typeof t.child === "string") stack.push(t.child);
    }
  }
  return Object.keys(surface.components).filter((id) => surface.components[id].status === "ok" && !reached.has(id));
}

/** Top-level visual units inside the root container (controller ruling: a Row is one unit, leaves are not counted). */
function visibleBlocks(surface: SurfaceState): number {
  let id = "root";
  const seen = new Set<string>();
  for (;;) {
    const entry = surface.components[id];
    if (!entry || entry.status !== "ok" || seen.has(id)) break;
    seen.add(id);
    const p = propsOf(entry);
    const type = typeOf(entry);
    const firstTab = type === "Tabs" && Array.isArray(p.tabs) ? p.tabs[0] : undefined;
    if (type === "Card" && typeof p.child === "string") id = p.child;
    else if (isPlainObject(firstTab) && typeof firstTab.child === "string") id = firstTab.child;
    else if (type === "Column" && Array.isArray(p.children) && p.children.length === 1 && typeof p.children[0] === "string") id = p.children[0];
    else break;
  }
  const main = surface.components[id];
  if (!main) return 0;
  if (main.status === "ok" && typeOf(main) === "Column") {
    const kids = propsOf(main).children;
    // Children that have not arrived render as skeletons, not as blocks.
    if (Array.isArray(kids)) return kids.filter((k) => typeof k === "string" && surface.components[k] !== undefined).length;
    if (isChildTemplate(kids)) {
      const st = templateState(kids, surface.data, "/");
      return st.kind === "items" ? st.items.length : 1;
    }
  }
  return 1;
}

/**
 * Options the person can really pick from: OptionCards a List draws from data (template items), each with a
 * non-empty title. Literal cards the composer wrote itself and items whose title is null do not count.
 */
export function listedOptions(surface: SurfaceState): number {
  return renderOrder(surface).filter((n) => {
    if (!n.inList || n.entry.status !== "ok" || typeOf(n.entry) !== "OptionCard") return false;
    try {
      return toText(resolve(propsOf(n.entry).title as Parameters<typeof resolve>[0], { data: surface.data, scope: n.scope })).trim() !== "";
    } catch {
      return false;
    }
  }).length;
}

/** Every component reachable from root (all tabs, all Accordion sections, templates expanded over the data), with its scope. */
function allNodes(surface: SurfaceState): Node[] {
  const out: Node[] = [];
  const seen = new Set<string>();
  const visit = (id: string, scope: string, inList: boolean, depth: number): void => {
    const key = id + "@" + scope;
    if (depth > 64 || seen.has(key)) return;
    seen.add(key);
    const entry = surface.components[id];
    if (!entry) return;
    out.push({ id, entry, scope, inList });
    const p = propsOf(entry);
    if (typeof p.child === "string") visit(p.child, scope, inList, depth + 1);
    const kids = p.children;
    if (Array.isArray(kids)) {
      for (const c of kids) if (typeof c === "string") visit(c, scope, inList || typeOf(entry) === "List", depth + 1);
    } else if (isChildTemplate(kids)) {
      const st = templateState(kids, surface.data, scope);
      if (st.kind === "items") for (const item of st.items) visit(kids.componentId, item.scope, true, depth + 1);
    }
    const sections = typeOf(entry) === "Accordion" ? p.items : typeOf(entry) === "Tabs" ? p.tabs : undefined;
    if (Array.isArray(sections)) for (const t of sections) if (isPlainObject(t) && typeof t.child === "string") visit(t.child, scope, inList, depth + 1);
  };
  visit("root", "/", false, 0);
  return out;
}

/** Every string and number leaf of a value, as trimmed strings (how the data-only judge compares). */
export function dataLeaves(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === "string") {
    if (value.trim() !== "") into.add(value.trim());
  } else if (typeof value === "number") {
    if (Number.isFinite(value)) into.add(String(value));
  } else if (Array.isArray(value)) {
    for (const v of value) dataLeaves(v, into);
  } else if (isPlainObject(value)) {
    for (const v of Object.values(value)) dataLeaves(v, into);
  }
  return into;
}

/**
 * Image urls and Rating values must come from live data (owner rule: no fact nobody stated). Returns the ids of
 * Image / Rating components whose shown url / value is not among the values data events delivered in this
 * session (`delivered`, see dataLeaves). A literal copy of a delivered value (a tapped item's fields) is fine;
 * nothing shown (null, empty) is fine. Compared as trimmed strings, so 4.5 and "4.5" match.
 */
export function dataOnlyViolations(surface: SurfaceState, delivered: ReadonlySet<string>): string[] {
  const bad = new Set<string>();
  for (const n of allNodes(surface)) {
    const type = typeOf(n.entry);
    if (n.entry.status !== "ok" || (type !== "Image" && type !== "Rating")) continue;
    const prop = propsOf(n.entry)[type === "Image" ? "url" : "value"];
    let shown: JsonValue | undefined;
    try {
      shown = resolve(prop as Parameters<typeof resolve>[0], { data: surface.data, scope: n.scope });
    } catch {
      shown = undefined;
    }
    if (shown === undefined || shown === null) continue;
    const text = toText(shown).trim();
    if (text !== "" && !delivered.has(text)) bad.add(n.id);
  }
  return [...bad];
}

/**
 * A confirm tap gets a summary step (composer rule 8) that must not carry an Alert or Badge: there they state things
 * no data line said ("You can pick a seat later", "Confirmed"). Ids of the Alerts / Badges drawn on such a step.
 */
export function summaryNotices(surface: SurfaceState, tappedAction: string | null): string[] {
  if (!tappedAction?.startsWith("confirm_")) return [];
  const ids = allNodes(surface).filter((n) => n.entry.status === "ok" && (typeOf(n.entry) === "Alert" || typeOf(n.entry) === "Badge")).map((n) => n.id);
  return [...new Set(ids)];
}

/** First OptionCard or Button (render order) whose action name starts with the prefix. */
function findTapTarget(surface: SurfaceState, prefix: string): { node: Node; action: Action } | null {
  for (const node of renderOrder(surface)) {
    const type = typeOf(node.entry);
    if (type !== "OptionCard" && type !== "Button") continue;
    const action = propsOf(node.entry).action;
    if (!isPlainObject(action) || !isPlainObject(action.event) || typeof action.event.name !== "string") continue;
    if (action.event.name.startsWith(prefix)) return { node, action: action as unknown as Action };
  }
  return null;
}

function sameJson(a: JsonValue | undefined, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── Weather lines ─────────────────────────────────────────────────────────────

type FetchLike = { source: string; ok: boolean; records: number; ms: number; error?: string };

/**
 * A weather line passes only if weather data arrived: a "weather" fetch with ok and records ≥ 1. A search made
 * for it is noted (the prompt says weather never searches), not failed.
 */
export function weatherCheck(fetches: readonly FetchLike[]): { ok: boolean; reason: string | null; notes: string[] } {
  const weather = fetches.filter((f) => f.source === "weather");
  const arrived = weather.filter((f) => f.ok).reduce((n, f) => n + f.records, 0);
  const notes = weather.map((f) => (f.ok ? `weather ${f.ms} ms / ${f.records} rec` : `weather failed: ${f.error ?? "unknown"}`));
  const searches = fetches.filter((f) => f.source === "search").length;
  if (searches > 0) notes.push(`${searches} search${searches === 1 ? "" : "es"} made for a weather line`);
  if (arrived >= 1) return { ok: true, reason: null, notes };
  return { ok: false, reason: weather.length ? "weather data did not arrive" : "no weather data line", notes };
}

/** Which weather bricks the screen drew (informational): an area Chart, a bound Icon, a List over the days. */
export function weatherBricks(surface: SurfaceState): string[] {
  const out = new Set<string>();
  for (const c of Object.values(surface.components)) {
    if (c.status !== "ok") continue;
    const p = c.def as unknown as Record<string, unknown>;
    if (c.def.component === "Chart" && p.type === "area") out.add("area Chart");
    if (c.def.component === "Icon" && isPlainObject(p.name)) out.add("bound Icon");
    if (c.def.component === "List" && isChildTemplate(p.children) && /days/.test(p.children.path)) out.add("days List");
    if (c.def.component === "Text" && JSON.stringify(p.text ?? "").includes("Open-Meteo")) out.add("credit");
  }
  return [...out];
}

// ── Patch outcome (a patch step is judged by what it changed) ─────────────────

/** What a spoken edit must do to the screen it was said on. Lives here because src/shared/scenarios.ts is a contract file. */
export type PatchExpect = { count: number; time: "later" };

/** Lines whose patch is checked value by value, not only as "route patch + no usage". */
export const PATCH_EXPECT: Readonly<Record<string, PatchExpect>> = {
  "We're six, and later.": { count: 6, time: "later" },
};

type ChoiceKnob = Extract<Knob, { type: "choice" }>;
type TimeValue = { date: string | null; minutes: number };

const TIME_RE = /^(\d{1,2}):(\d{2})$/;
const DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const PEOPLE_RE = /guest|people|person|party|diner|pax|cover|group/i;

/** "19:00", ["19:00"] (a ChoicePicker selection) or "2026-11-25T19:00" → date + minutes; null when unset or any other shape. */
export function parseTime(v: JsonValue | undefined): TimeValue | null {
  const s = Array.isArray(v) && v.length === 1 ? v[0] : v;
  if (typeof s !== "string") return null;
  const t = TIME_RE.exec(s);
  if (t) return { date: null, minutes: Number(t[1]) * 60 + Number(t[2]) };
  const dt = DATE_TIME_RE.exec(s);
  return dt ? { date: dt[1], minutes: Number(dt[2]) * 60 + Number(dt[3]) } : null;
}

/**
 * Time controls: a single-choice ChoicePicker of "HH:mm" chips, a time-only DateTimeInput, or a date+time
 * DateTimeInput. A date-only DateTimeInput (a Day) is not one: "later" must never move a date.
 */
export function timeControls(knobs: Knob[]): ChoiceKnob[] {
  return knobs.filter((k): k is ChoiceKnob => {
    if (k.type !== "choice") return false;
    const allSlots = k.options.length > 0 && k.options.every((o) => TIME_RE.test(o.key));
    if (k.component === "ChoicePicker") return allSlots;
    if (k.component !== "DateTimeInput") return false;
    // A date+time knob mixes date keys ("Thu 26 Nov") with time slots, so its current value identifies it.
    return allSlots || (typeof k.current === "string" && DATE_TIME_RE.test(k.current));
  });
}

/** The knob offers a time later than its current one on the same date (chips are linear; DateTimeInput slots can cross midnight). */
export function laterOnSameDate(knob: ChoiceKnob): boolean {
  const cur = parseTime(knob.current);
  if (!cur) return false;
  return knob.options.some((o) => {
    const t = parseTime(o.value);
    return t !== null && t.date === cur.date && t.minutes > cur.minutes;
  });
}

/** The people count: a Stepper or Slider, the one labelled for people when there are several. */
export function countControl(knobs: Knob[]): ChoiceKnob | null {
  const counts = knobs.filter((k): k is ChoiceKnob => k.type === "choice" && (k.component === "Stepper" || k.component === "Slider"));
  const people = counts.filter((k) => PEOPLE_RE.test(k.label) || PEOPLE_RE.test(k.path));
  return people[0] ?? (counts.length === 1 ? counts[0] : null);
}

export type PatchPlan =
  | { expected: "patch"; count: ChoiceKnob; times: ChoiceKnob[] }
  /** The screen cannot hold the whole edit, so a patch would drop part of it (the router's partial-edit rule). */
  | { expected: "compose"; dropped: string; why: string };

/** What the screen before the step allows: a patch only when it can express both the count and "later". */
export function planPatch(knobs: Knob[], want: PatchExpect): PatchPlan {
  const times = timeControls(knobs);
  if (times.length === 0) return { expected: "compose", dropped: "later", why: "no time control on screen" };
  if (!times.some(laterOnSameDate)) {
    const unset = times.every((k) => parseTime(k.current) === null);
    return { expected: "compose", dropped: "later", why: unset ? "the time control has no value to be later than" : "no later time on the same date" };
  }
  const count = countControl(knobs);
  if (!count) return { expected: "compose", dropped: "the count", why: "no people count on screen" };
  if (count.current !== want.count && !count.options.some((o) => o.value === want.count)) {
    return { expected: "compose", dropped: "the count", why: `${count.label} cannot be ${want.count}` };
  }
  return { expected: "patch", count, times };
}

function asObject(v: JsonValue | undefined): JsonObject | null {
  return isPlainObject(v) ? (v as JsonObject) : null;
}

/** JSON Pointers of the leaves that differ between two data models (arrays compared by index). */
export function changedLeaves(a: JsonValue | undefined, b: JsonValue | undefined, tokens: string[] = []): string[] {
  const oa = asObject(a);
  const ob = asObject(b);
  if (oa && ob) {
    const keys = new Set([...Object.keys(oa), ...Object.keys(ob)]);
    return [...keys].flatMap((k) => changedLeaves(oa[k], ob[k], [...tokens, k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return Array.from({ length: Math.max(a.length, b.length) }, (_, i) => changedLeaves(a[i], b[i], [...tokens, String(i)])).flat();
  }
  return sameJson(a, b) ? [] : [formatPointer(tokens)];
}

function show(v: JsonValue | undefined): string {
  return v === undefined ? "unset" : JSON.stringify(v);
}

function clock(minutes: number): string {
  return String(Math.floor(minutes / 60)).padStart(2, "0") + ":" + String(minutes % 60).padStart(2, "0");
}

function shift(before: JsonValue | undefined, after: JsonValue | undefined): string {
  const b = parseTime(before);
  const a = parseTime(after);
  if (!b || !a || sameJson(before, after)) return "";
  if (a.date !== b.date) return ` (date ${b.date ?? "none"} → ${a.date ?? "none"})`;
  const d = a.minutes - b.minutes;
  return ` (${d > 0 ? "+" : ""}${d} min, same date)`;
}

export type PatchCheck = { ok: boolean; reasons: string[]; values: string[] };

/**
 * Judges a patch by its result: the count equals want.count, exactly one time control moved later on the
 * same date, and no other data value changed. On a screen that cannot hold the whole edit (see planPatch)
 * every patch fails, since it dropped part of what was said.
 */
export function checkPatchOutcome(knobs: Knob[], before: JsonValue | undefined, after: JsonValue | undefined, want: PatchExpect): PatchCheck {
  const plan = planPatch(knobs, want);
  const reasons: string[] = [];
  const values: string[] = [];
  const changed = changedLeaves(before, after);
  const change = (p: string) => `${p}: ${show(getAt(before, p))} → ${show(getAt(after, p))}`;
  if (plan.expected === "compose") {
    values.push(...(changed.length ? changed.map(change) : ["nothing changed"]));
    reasons.push(`${plan.dropped} dropped: patched although ${plan.why} (expected compose)`);
    return { ok: false, reasons, values };
  }
  const { count, times } = plan;
  const countAfter = getAt(after, count.path);
  values.push(`${count.label} ${change(count.path)}`);
  if (countAfter !== want.count) reasons.push(`${count.label} is ${show(countAfter)}, expected ${want.count}`);
  for (const k of times) values.push(`${k.label} ${change(k.path)}${shift(getAt(before, k.path), getAt(after, k.path))}`);
  const moved = times.find((k) => !sameJson(getAt(before, k.path), getAt(after, k.path)));
  if (!moved) {
    reasons.push(`later dropped: ${times.map((k) => k.label).join(", ")} unchanged`);
  } else {
    const b = parseTime(getAt(before, moved.path));
    const a = parseTime(getAt(after, moved.path));
    if (!b || !a) reasons.push(`${moved.label} is not a time after the patch: ${show(getAt(after, moved.path))}`);
    else if (a.date !== b.date) reasons.push(`${moved.label} moved to another date (${b.date} → ${a.date})`);
    else if (a.minutes <= b.minutes) reasons.push(`${moved.label} is not later (${clock(b.minutes)} → ${clock(a.minutes)})`);
  }
  const allowed = moved ? [count.path, moved.path] : [count.path];
  const others = changed.filter((p) => !allowed.some((q) => p === q || p.startsWith(q + "/")));
  const shown = new Set(times.map((k) => k.path));
  for (const p of others) if (!shown.has(p)) values.push(change(p));
  if (others.length) reasons.push(`other values changed: ${others.join(", ")}`);
  return { ok: reasons.length === 0, reasons, values };
}

// ── One turn ──────────────────────────────────────────────────────────────────

type StepResult = {
  /** Classification aid printed under the line (route, knobs sent, composer lines, surface). */
  diag: string[];
  job: Job;
  run: number;
  step: number;
  status: "pass" | "fail" | "not run";
  reasons: string[];
  notes: string[];
  firstUi: number | null;
  screen: number | null;
  data: number | null;
  done: number | null;
  outTokens: number | null;
  searchMs: number | null;
  records: number | null;
  blocks: number | null;
  route: string | null;
  expectOk: boolean | null;
  model: string | null;
  patch: PatchReport | null;
};

/** The patch check of one step (PATCH_EXPECT lines), printed per run and kept in --raw. */
type PatchReport = {
  /** What the screen before the step allows (planPatch). */
  expected: "patch" | "compose";
  why: string | null;
  /** Route decision and the router's reason. */
  route: string;
  /** label path: before → after, per control and per other changed value. */
  values: string[];
  ok: boolean;
  reasons: string[];
};

/** The newest surface as the step found it: its knobs (as the turn client derives them) and a copy of its data. */
type PreStep = { surfaceId: string; knobs: Knob[]; data: JsonValue };

function preStep(st: StoreApi): PreStep | null {
  const s = st.getState();
  const surface = s.newestSurfaceId ? s.surfaces[s.newestSurfaceId] : undefined;
  if (!surface) return null;
  const defs = Object.values(surface.components).flatMap((c) => (c.status === "ok" ? [c.def] : []));
  const data = structuredClone(surface.data);
  return { surfaceId: surface.id, knobs: deriveKnobs(defs, data), data };
}

type Timed = { t: number; ev: TurnEvent };

function lastAgent(st: StoreApi): AgentItem | null {
  const thread = st.getState().thread;
  for (let i = thread.length - 1; i >= 0; i--) {
    const item = thread[i];
    if (item.kind === "agent") return item;
  }
  return null;
}

function maxT(events: Timed[], pick: (ev: TurnEvent) => boolean): number | null {
  let best: number | null = null;
  for (const { t, ev } of events) if (pick(ev) && (best === null || t > best)) best = t;
  return best === null ? null : Math.round(best);
}

function evaluate(
  job: Job,
  run: number,
  step: number,
  st: StoreApi,
  agent: AgentItem,
  expect: ScenarioExpect | undefined,
  notes: string[],
  say: string | null,
  pre: PreStep | null,
  strict: boolean,
  delivered: ReadonlySet<string>,
): StepResult {
  const state = st.getState();
  const events: Timed[] = state.recordings[agent.turnId]?.events ?? [];
  const m = agent.metrics;
  const reasons: string[] = [];
  const fetches = m.fetches ?? [];
  const searches = fetches.filter((f) => f.source === "search");
  const result: StepResult = {
    diag: [],
    job,
    run,
    step,
    status: "pass",
    reasons,
    notes,
    firstUi: m.clientFirstUiMs === undefined ? null : Math.round(m.clientFirstUiMs),
    screen: maxT(events, (ev) => (ev.type === "a2ui" && ev.origin !== "data") || ev.type === "caption" || ev.type === "widget" || ev.type === "text" || ev.type === "html"),
    data: maxT(events, (ev) => ev.type === "fetch"),
    done: maxT(events, (ev) => ev.type === "done"),
    outTokens: m.usage?.output_tokens ?? null,
    searchMs: searches.length ? Math.max(...searches.map((f) => f.ms)) : null,
    records: searches.length ? searches.reduce((n, f) => n + f.records, 0) : null,
    blocks: null,
    route: m.route ? m.route.decision : null,
    expectOk: null,
    model: m.usage?.model ?? null,
    patch: null,
  };
  for (const f of fetches) {
    if (!f.ok && f.source !== "weather") notes.push(`${f.source} failed: ${f.error ?? "unknown"}`);
  }
  if (job.needs === "weather") {
    const w = weatherCheck(fetches);
    notes.push(...w.notes);
    if (w.reason) reasons.push(w.reason);
  } else {
    for (const f of fetches) if (!f.ok && f.source === "weather") notes.push(`weather failed: ${f.error ?? "unknown"}`);
  }
  if (agent.status === "error") reasons.push(`error: ${agent.error ?? "unknown"}`);
  else if (agent.status !== "done") reasons.push(`turn ended as ${agent.status}`);

  if (job.mode === "a2ui") {
    const errors = state.wire.filter((w) => w.turnId === agent.turnId && w.kind === "error");
    if (m.refused > 0) reasons.push(`${m.refused} refused`);
    if (errors.length > 0) reasons.push(`${errors.length} validation errors (${errors.map((w) => w.summary).join("; ")})`);
    const surfaceId = agent.surfaceId ?? agent.updatedSurfaceId;
    const surface = surfaceId ? state.surfaces[surfaceId] : undefined;
    if (!surface) {
      reasons.push("no surface created or updated");
    } else {
      const nodes = renderOrder(surface);
      result.blocks = visibleBlocks(surface);
      if (!nodes.some((n) => n.entry.status === "ok")) reasons.push("nothing rendered from root");
      if (result.blocks > MAX_BLOCKS) reasons.push(`${result.blocks} visible blocks`);
      if (job.needs === "weather") notes.push(`bricks: ${weatherBricks(surface).join(", ") || "none of area Chart, bound Icon, days List, credit"}`);
      const lost = orphans(surface);
      if (lost.length) notes.push(`not reachable from root: ${lost.join(", ")}`);
      const invented = dataOnlyViolations(surface, delivered);
      if (invented.length) reasons.push(`invented: ${invented.join(", ")}`);
      const tapped = agent.retry.input.type === "action" ? agent.retry.input.action.name : null;
      const notices = summaryNotices(surface, tapped);
      if (notices.length) reasons.push(`notice on summary: ${notices.join(", ")}`);
      if (expect?.bricks || expect?.data) {
        const types = new Set<string>(Object.values(surface.components).flatMap((c) => (c.status === "ok" ? [c.def.component] : [])));
        const missing = (expect.bricks ?? []).filter((b) => !types.has(b));
        const wrongData = Object.entries(expect.data ?? {}).filter(([path, v]) => !sameJson(getAt(surface.data, path), v));
        result.expectOk = missing.length === 0 && wrongData.length === 0;
        const into = strict ? reasons : notes;
        if (missing.length) into.push(`expected bricks missing: ${missing.join(", ")}`);
        if (wrongData.length) into.push(`expected data differs at ${wrongData.map(([p]) => p).join(", ")}`);
      }
      // A step that offers options must offer real ones (the stage needs something to tap).
      if (expect?.bricks?.includes("OptionCard")) {
        const shown = listedOptions(surface);
        notes.push(`options ${shown}`);
        if (shown === 0) {
          const why = searches.length ? searches.map((f) => (f.ok ? `search ${f.records} records` : `search failed`)).join(", ") : "no search";
          reasons.push(`options list empty (${why})`);
        }
      }
    }
    const usage = events.some((e) => e.ev.type === "usage");
    const routeText = m.route ? `${m.route.decision} (${m.route.reason})` : "missing";
    const spec = say !== null ? PATCH_EXPECT[say] : undefined;
    if (spec && pre) {
      const plan = planPatch(pre.knobs, spec);
      const report: PatchReport = { expected: plan.expected, why: plan.expected === "compose" ? plan.why : null, route: routeText, values: [], ok: true, reasons: [] };
      if (m.route?.decision === "patch") {
        const check = checkPatchOutcome(pre.knobs, pre.data, state.surfaces[pre.surfaceId]?.data, spec);
        report.values = check.values;
        report.reasons.push(...check.reasons);
        if (usage) report.reasons.push("LLM was called (usage event)");
      } else {
        report.values = pre.knobs.map((k) => `${k.label} ${k.path}: ${show(getAt(pre.data, k.path))} (before; not patched)`);
        if (plan.expected === "patch") report.reasons.push(`route ${routeText}, expected patch`);
        else if (!m.route) report.reasons.push("route missing, expected compose");
      }
      report.ok = report.reasons.length === 0;
      reasons.push(...report.reasons);
      result.patch = report;
    } else if (expect?.patchOnly) {
      if (m.route?.decision !== "patch") reasons.push(`route ${routeText}, expected patch`);
      if (usage) reasons.push("LLM was called (usage event)");
    } else if (m.route?.decision === "patch" && pre) {
      const after = state.surfaces[pre.surfaceId]?.data;
      const changes = changedLeaves(pre.data, after).map((p) => `${p}: ${show(getAt(pre.data, p))} → ${show(getAt(after, p))}`);
      notes.push(`patch not asserted (no expected outcome for this line): ${changes.join("; ") || "nothing changed"}`);
    }
  } else if (job.mode === "widgets") {
    if (!agent.widget && !agent.text?.trim()) reasons.push("no widget and no text");
    if (agent.widget) notes.push(`widget ${agent.widget.name}`);
    else if (agent.text?.trim()) notes.push("text answer");
  } else if (!agent.html?.trim()) {
    reasons.push("no html");
  }
  result.status = reasons.length ? "fail" : "pass";
  return result;
}

// ── Diagnostics (to classify misses: composer, router or the smoke matcher) ──────

function short(v: unknown, n = 70): string {
  const s = JSON.stringify(v) ?? String(v);
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function describeMsg(msg: A2uiMessage): string {
  if ("createSurface" in msg) return `createSurface ${msg.createSurface.surfaceId}`;
  if ("deleteSurface" in msg) return `deleteSurface ${msg.deleteSurface.surfaceId}`;
  if ("updateDataModel" in msg) return `updateDataModel ${msg.updateDataModel.surfaceId} ${msg.updateDataModel.path ?? "/"} ${short(msg.updateDataModel.value)}`;
  return `updateComponents ${msg.updateComponents.surfaceId} ${msg.updateComponents.components.map((c) => `${String(c.id)}/${String(c.component)}`).join(",")}`;
}

function describeKnob(k: Knob): string {
  if (k.type === "bool") return `${k.label} [${k.component} bool] current=${k.current}`;
  const keys = k.options.map((o) => o.key);
  const shown = keys.length > 10 ? `${keys.slice(0, 10).join(",")},… (${keys.length})` : keys.join(",");
  return `${k.label} [${k.component} ${k.type}] path=${k.path} current=${short(k.current, 40)} options=${shown}`;
}

function describeData(data: JsonValue): string {
  if (!isPlainObject(data)) return short(data);
  return Object.entries(data)
    .map(([k, v]) => (Array.isArray(v) ? `${k}[${v.length}]` : `${k}=${short(v, 60)}`))
    .join(", ");
}

/** The route event and Jev's reason, the knobs the request carried, what the composer/knob lines wrote, and the surface. */
function diagnose(st: StoreApi, surfaceId: string | null | undefined, agent: AgentItem | null, request: TurnRequest | null): string[] {
  const s = st.getState();
  const out: string[] = [];
  if (agent) {
    const events = s.recordings[agent.turnId]?.events ?? [];
    const route = events.find((e) => e.ev.type === "route")?.ev;
    out.push(
      route?.type === "route"
        ? `route: kind=${route.kind} decision=${route.decision} patches=${route.patches} engine=${route.engine} ${route.ms} ms; reason: ${route.reason}`
        : "route: none (the turn was not routed)",
    );
    const lines = events.flatMap(({ ev }) => (ev.type === "a2ui" && ev.origin !== "data" ? [`${ev.origin}: ${describeMsg(ev.msg)}`] : []));
    if (lines.length) out.push(`lines: ${lines.join(" | ")}`);
    if (agent.caption) out.push(`caption: ${agent.caption}`);
  }
  if (request) {
    const knobs = request.surface?.knobs ?? [];
    out.push(request.surface ? `knobs sent (surface ${request.surface.id}): ${knobs.length ? knobs.map(describeKnob).join("; ") : "none"}` : "knobs sent: no surface");
  }
  const surface = surfaceId ? s.surfaces[surfaceId] : undefined;
  if (surface) {
    out.push(`surface ${surface.id}: ${Object.entries(surface.components).map(([id, c]) => `${id}/${typeOf(c)}${c.status === "refused" ? "(refused)" : ""}`).join(", ")}`);
    out.push(`data ${surface.id}: ${describeData(surface.data)}`);
  }
  return out;
}

// ── Formatting ────────────────────────────────────────────────────────────────

const ms = (v: number | null) => (v === null ? "–" : v >= 1000 ? `${(v / 1000).toFixed(2)} s` : `${v} ms`);
const num = (v: number | null) => (v === null ? "–" : String(v));

function stepText(step: ScenarioStep): string {
  return "say" in step ? `"${step.say}"` : `tap ${step.tap}*`;
}

function lineLabel(r: { job: Job; step: number }): string {
  return `${r.job.mode} · ${r.job.id} #${r.step + 1} ${stepText(r.job.steps[r.step])}`;
}

function printResult(r: StepResult): void {
  const head = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "SKIP";
  const parts = [
    `run ${r.run + 1}/${r.job.runs}`,
    `first UI ${ms(r.firstUi)}`,
    `screen ${ms(r.screen)}`,
    `data ${ms(r.data)}`,
    `out ${num(r.outTokens)} tok`,
    `search ${ms(r.searchMs)} / ${num(r.records)} rec`,
    `blocks ${num(r.blocks)}`,
  ];
  if (r.route) parts.push(`route ${r.route}`);
  const why = [...r.reasons, ...r.notes];
  console.log(`${head} ${lineLabel(r)} · ${parts.join(" · ")}${why.length ? ` · ${why.join("; ")}` : ""}`);
  if (r.patch) {
    console.log(`    patch expected ${r.patch.expected}${r.patch.why ? ` (${r.patch.why})` : ""} · route ${r.patch.route}`);
    for (const v of r.patch.values) console.log(`    patch ${v}`);
  }
  for (const d of r.diag) console.log(`    diag ${d}`);
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return Math.round(s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2);
}

/** "median (min–max)" over measured values; "–" when nothing was measured. */
function spread(values: (number | null)[], fmt: (v: number | null) => string): string {
  const got = values.filter((v): v is number => v !== null);
  if (got.length === 0) return "–";
  const med = fmt(median(got));
  if (got.length === 1) return med;
  return `${med} (${fmt(Math.min(...got))}–${fmt(Math.max(...got))})`;
}

function summaryTable(results: StepResult[]): string {
  const groups = new Map<string, StepResult[]>();
  for (const r of results) {
    const key = `${r.job.mode}|${r.job.id}|${r.step}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const rows = [
    "| mode | line | pass | first UI | screen done | data arrived | output tokens | search ms | records | blocks | notes |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const rs of groups.values()) {
    const ran = rs.filter((r) => r.status !== "not run");
    const passed = rs.filter((r) => r.status === "pass").length;
    const notRun = rs.length - ran.length;
    const notes = [...new Set(rs.flatMap((r) => [...r.reasons, ...r.notes]))];
    if (notRun) notes.unshift(`${notRun} not run (an earlier step failed)`);
    const expect = ran.filter((r) => r.expectOk !== null);
    if (expect.length) notes.unshift(`expect ${expect.filter((r) => r.expectOk).length}/${expect.length}`);
    const first = rs[0];
    rows.push(
      [
        "",
        first.job.mode,
        `${first.job.id} #${first.step + 1} ${stepText(first.job.steps[first.step]).replace(/\|/g, "\\|")}`,
        `${passed}/${rs.length}`,
        spread(ran.map((r) => r.firstUi), ms),
        spread(ran.map((r) => r.screen), ms),
        spread(ran.map((r) => r.data), ms),
        spread(ran.map((r) => r.outTokens), num),
        spread(ran.map((r) => r.searchMs), num),
        ran.some((r) => r.records !== null) ? ran.map((r) => num(r.records)).join(", ") : "–",
        spread(ran.map((r) => r.blocks), num),
        notes.join("; ").replace(/\|/g, "\\|") || "",
        "",
      ].join(" | ").trim(),
    );
  }
  return rows.join("\n");
}

/** PLAN §8 step 13 check: a scenario run passes when every one of its steps passes. */
function scenarioChecks(results: StepResult[]): string[] {
  const runs = new Map<string, { group: string; ok: boolean }>();
  for (const r of results) {
    if (r.job.mode !== "a2ui") continue;
    const key = `${r.job.id}|${r.run}`;
    const group = r.job.needs === "weather" ? "weather" : r.job.group;
    const prev = runs.get(key) ?? { group, ok: true };
    runs.set(key, { group: prev.group, ok: prev.ok && r.status === "pass" });
  }
  const line = (label: string, group: string, target: string) => {
    const rs = [...runs.values()].filter((r) => r.group === group);
    if (rs.length === 0) return null;
    const ok = rs.filter((r) => r.ok).length;
    return `- ${label}: ${ok}/${rs.length} scenario runs pass (${Math.round((ok / rs.length) * 100)}%; target ${target})`;
  };
  return [
    line("Main scenarios (dinner, flight)", "main", "100%"),
    line("Wildcards (bill, packing, quiz)", "wildcard", "≥ 80%"),
    line("Contrast (pink)", "contrast", "–"),
    line("Held-out lines", "heldout", "–"),
    line("Weather lines (held-out)", "weather", "100%"),
  ].filter((l): l is string => l !== null);
}

/** One line per checked patch step: verdict, what the screen allowed, the route and its reason, before → after values. */
function patchSection(results: StepResult[]): string[] {
  const lines = results.flatMap((r) => {
    const p = r.patch;
    if (!p) return [];
    const why = p.why ? ` (${p.why})` : "";
    const fail = p.reasons.length ? ` · ${p.reasons.join("; ")}` : "";
    return [`- ${r.job.id} #${r.step + 1} run ${r.run + 1}: ${p.ok ? "PASS" : "FAIL"} · expected ${p.expected}${why} · route ${p.route} · ${p.values.join("; ")}${fail}`];
  });
  return lines.length ? ["## Patch checks", "", ...lines, ""] : [];
}

function berlinTime(d: Date): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", dateStyle: "medium", timeStyle: "short" }).format(d);
}

function gitHead(): string {
  try {
    const out = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]);
    return out.success ? out.stdout.toString().trim() : "unknown";
  } catch {
    return "unknown";
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runJob(job: Job, run: number, opts: Options, key: string, results: StepResult[]): Promise<void> {
  const st = createStore();
  st.setMode(job.mode);
  /** The body the turn client sent, kept for the diagnostics (its knobs). */
  let lastRequest: TurnRequest | null = null;
  const client = createTurnClient({
    store: st,
    // The browser's apiFetch, against another origin.
    fetch: (path, init) => {
      if (typeof init.body === "string") {
        try {
          lastRequest = JSON.parse(init.body) as TurnRequest;
        } catch (err) {
          console.warn("smoke: could not read the request body for diagnostics", err);
          lastRequest = null;
        }
      }
      const headers = new Headers(init.headers);
      headers.set("x-demo-key", key);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      return fetch(opts.baseUrl + path, { ...init, headers });
    },
  });
  let blocked: string | null = null;
  const delivered = new Set<string>();
  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i];
    const notes: string[] = [];
    if (blocked) {
      const r: StepResult = {
        diag: [], job, run, step: i, status: "not run", reasons: [blocked], notes, firstUi: null, screen: null, data: null, done: null,
        outTokens: null, searchMs: null, records: null, blocks: null, route: null, expectOk: null, model: null, patch: null,
      };
      results.push(r);
      printResult(r);
      continue;
    }
    const before = lastAgent(st);
    lastRequest = null;
    const say = "say" in step ? step.say : null;
    const pre = say !== null ? preStep(st) : null;
    if ("say" in step) {
      await client.sendTurn({ input: { type: "utterance", text: step.say }, display: step.say, via: "text" });
    } else {
      const s = st.getState();
      const surface = s.newestSurfaceId ? s.surfaces[s.newestSurfaceId] : undefined;
      const target = surface ? findTapTarget(surface, step.tap) : null;
      if (!surface || !target) {
        const r: StepResult = {
          diag: diagnose(st, surface?.id, before, null),
          job, run, step: i, status: "fail", reasons: [`no OptionCard/Button action starting with "${step.tap}" on the newest surface`], notes,
          firstUi: null, screen: null, data: null, done: null, outTokens: null, searchMs: null, records: null, blocks: null, route: null, expectOk: null, model: null,
          patch: null,
        };
        results.push(r);
        printResult(r);
        blocked = `step ${i + 1} had no tap target`;
        continue;
      }
      const checks = propsOf(target.node.entry)["@checks"];
      const verdict = evalChecks(Array.isArray(checks) ? (checks as CheckRule[]) : undefined, { data: surface.data, scope: target.node.scope });
      if (!verdict.ok) notes.push(`tapped a disabled ${typeOf(target.node.entry)} (check: ${verdict.message ?? ""})`);
      const action = st.emitAction(surface.id, target.node.id, target.action, target.node.scope);
      notes.push(`tapped ${action.name}`);
      await client.sendAction(action);
    }
    const agent = lastAgent(st);
    if (!agent || agent === before) throw new Error("the turn client started no turn");
    // Values live data delivered in this session so far (any turn): the data-only judge's reference.
    for (const { ev } of st.getState().recordings[agent.turnId]?.events ?? []) {
      if (ev.type === "a2ui" && ev.origin === "data") dataLeaves(ev.msg, delivered);
    }
    const r = evaluate(job, run, i, st, agent, step.expect, notes, say, pre, opts.strict, delivered);
    const patchMiss = r.patch
      ? !r.patch.ok
      : step.expect?.patchOnly === true && (r.route !== "patch" || r.reasons.some((x) => x.startsWith("LLM was called")));
    if (job.mode === "a2ui" && (patchMiss || r.expectOk === false)) {
      r.diag = diagnose(st, agent.surfaceId ?? agent.updatedSurfaceId ?? st.getState().newestSurfaceId, agent, lastRequest);
    }
    results.push(r);
    printResult(r);
    if (opts.raw) {
      mkdirSync(opts.raw, { recursive: true });
      const rec = st.getState().recordings[agent.turnId];
      writeFileSync(join(opts.raw, `${job.mode}-${job.id}-run${run + 1}-step${i + 1}.json`), JSON.stringify({ input: agent.retry.input, request: lastRequest, patch: r.patch, diag: r.diag, ...rec }, null, 1));
    }
    if (agent.status === "error" && /^HTTP 40[13]/.test(agent.error ?? "")) {
      throw new Error(`stopping: ${agent.error} (check DEMO_KEY)`);
    }
    if (agent.status !== "done") blocked = `step ${i + 1} ended with an error`;
  }
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const key = demoKey();
  const jobs = buildJobs(opts);
  const turns = jobs.reduce((n, j) => n + j.steps.length * j.runs, 0);
  const started = new Date();
  console.log(`Smoke: ${opts.baseUrl} · ${jobs.length} jobs · up to ${turns} turns · started ${berlinTime(started)} (Europe/Berlin)`);
  const results: StepResult[] = [];
  // Run-major order spreads each line's runs over the whole session; sequential so timings are not contended.
  const maxRuns = Math.max(...jobs.map((j) => j.runs));
  for (let run = 0; run < maxRuns; run++) {
    for (const job of jobs) {
      if (run < job.runs) await runJob(job, run, opts, key, results);
    }
  }
  const ended = new Date();
  const table = summaryTable(results);
  const checks = scenarioChecks(results);
  const models = [...new Set(results.map((r) => r.model).filter((m): m is string => m !== null))];
  const passed = results.filter((r) => r.status === "pass").length;
  const md = [
    "# Smoke results (step 13)",
    "",
    `- Target: ${opts.baseUrl}`,
    `- Run: ${berlinTime(started)} to ${berlinTime(ended)} (Europe/Berlin), from a dev machine in Germany; times are client-observed from request start.`,
    `- Script tree: ${gitHead()}. Models reported by the Worker: ${models.join(", ") || "–"}.`,
    ...(opts.note ? [`- Note: ${opts.note}`] : []),
    `- a2ui: every scenario (all steps) and ${HELD_OUT.length} held-out lines, ${opts.runs}× each, decision model on. widgets and html: each scenario's opening line once, in the modes it lists.`,
    "- Pass: at least one component rendered (widgets: a widget or text; html: a page); 0 refused and 0 validation errors in the real client processor; ≤ 7 visible blocks; no error; on a step that expects OptionCards, at least one OptionCard drawn by a List from data with a non-empty title (\"options N\" in the notes); every Image url and Rating value on screen was delivered by a data event in that session (\"invented: ids\" otherwise); no Alert or Badge on the summary step after a confirm_ tap (\"notice on summary: ids\"); a weather line also needs weather data to arrive (a \"weather\" fetch, ok, records ≥ 1).",
    ...(opts.strict ? ["- --strict: a step also fails when its expected bricks or data are missing."] : []),
    "- Patch step (\"We're six, and later.\"), judged by its result in the real processor: if the screen before it has a people count (Stepper/Slider) and a time control (ChoicePicker of HH:mm, time or date+time DateTimeInput) with a later time on the same date, the route must patch with no usage event, the count must be 6, one time control must move later on the same date, and no other data value may change. Otherwise the route must compose, and a patch fails (\"later dropped\"). Per-run values are under \"Patch checks\".",
    "- Visible block (controller ruling): a top-level visual unit inside the root container. The root is unwrapped through Cards, single-child Columns and the first tab; each child of the main Column counts once, whatever it holds (a label/value Row, a List, a nested Column or Card, a Button).",
    "- first UI: the turn's surface has a root (patch steps: the first knob change). screen done: last composer or knob line, caption, widget or html. data arrived: last live data event. Search ms is the Worker's own measure (the longest search of the turn); records are summed over the turn's searches.",
    `- Medians with (min–max). "–" means not measured. "expect" counts the scenario's expected bricks/data (${opts.strict ? "part of pass (--strict)" : "informational, not part of pass"}).`,
    "",
    `**${passed}/${results.length} lines pass.**`,
    "",
    ...checks,
    "",
    table,
    "",
    ...patchSection(results),
  ].join("\n");
  writeFileSync(opts.out, md);
  console.log("\n" + checks.join("\n") + "\n\n" + table + `\n\nWrote ${opts.out}`);
  process.exitCode = passed === results.length ? 0 : 1;
}

// Guarded so scripts/smoke.test.ts can import the pure helpers without starting a run.
if (import.meta.main) await main();
