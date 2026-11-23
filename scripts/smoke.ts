/**
 * Step 13 smoke run (PLAN §8): every scenario in src/shared/scenarios.ts plus five held-out lines,
 * driven through the real client code (store, turn client, A2UI processor, knobs) against a running
 * Brick Box, by default the deployed one.
 *   bun run smoke [baseUrl] [--runs 3] [--only dinner,flight,heldout] [--out scripts/smoke-results.md] [--raw dir] [--note "..."]
 * DEMO_KEY comes from the environment or .dev.vars and is never printed.
 *
 * a2ui runs every scenario (all steps) and every held-out line --runs times; widgets and html run each
 * scenario's opening line once, in the modes the scenario lists.
 * A line passes when: at least one component rendered (widgets: a widget or text; html: a page),
 * no refused components and no validation errors from the real processor, at most 7 visible blocks,
 * no error, and for patchOnly steps a route decision "patch" with no usage event (no LLM call).
 * Visible block: a component reachable from "root" in render order that is not a layout container
 * (Card, Column, Row, Tabs; only the first tab is visible). A List counts as one block, a Button as one
 * (its label is part of it), a refused placeholder as one.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Action, CheckRule, JsonValue } from "@shared/a2ui";
import { isChildTemplate, isPlainObject } from "@shared/a2ui";
import { getAt } from "@shared/pointer";
import type { Mode, TurnEvent } from "@shared/protocol";
import { SCENARIOS, type ScenarioExpect, type ScenarioStep } from "@shared/scenarios";
import { evalChecks } from "../src/client/a2ui/evaluate";
import { templateState } from "../src/client/a2ui/template";
import type { AgentItem, ComponentEntry, StoreApi, SurfaceState } from "../src/client/state";
import { createStore } from "../src/client/store";
import { createTurnClient } from "../src/client/turns";

const DEFAULT_URL = "https://brick-box.shahriarbijoy.workers.dev";
const MAX_BLOCKS = 7;
const CONTAINERS = new Set(["Card", "Column", "Row", "Tabs"]);

/**
 * The held-out lines exist only as summaries in lane-W-report.md; this wording is reconstructed and
 * matches scripts/live-search.ts (imported by copy, since importing that script would run it).
 */
const HELD_OUT: readonly { id: string; title: string; say: string }[] = [
  { id: "lisbon", title: "Held-out: Lisbon trip", say: "Plan a 3-day trip to Lisbon in March." },
  { id: "phones", title: "Held-out: phone plans", say: "Compare two phone plans for me." },
  { id: "dog", title: "Held-out: adopt a dog", say: "I want to adopt a dog. What do I need?" },
  { id: "gift", title: "Held-out: gift for mum", say: "Find a gift for my mum, around 50 euros." },
  { id: "haircut", title: "Held-out: haircut Saturday", say: "Book a haircut for Saturday morning." },
];

// ── CLI ───────────────────────────────────────────────────────────────────────

type Options = { baseUrl: string; runs: number; only: Set<string> | null; out: string; raw: string | null; note: string | null };

function parseArgs(argv: string[]): Options {
  const opts: Options = { baseUrl: DEFAULT_URL, runs: 3, only: null, out: join("scripts", "smoke-results.md"), raw: null, note: null };
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

type Job = { id: string; title: string; group: string; mode: Mode; steps: ScenarioStep[]; runs: number };

function buildJobs(opts: Options): Job[] {
  const wanted = (id: string, group: string) => !opts.only || opts.only.has(id) || opts.only.has(group);
  const jobs: Job[] = [];
  for (const s of SCENARIOS) {
    if (wanted(s.id, s.group)) jobs.push({ id: s.id, title: s.title, group: s.group, mode: "a2ui", steps: s.steps, runs: opts.runs });
  }
  for (const h of HELD_OUT) {
    if (wanted(h.id, "heldout")) jobs.push({ id: h.id, title: h.title, group: "heldout", mode: "a2ui", steps: [{ say: h.say }], runs: opts.runs });
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
      // A Button's child is its label; every other brick is a leaf.
    }
  };
  visit("root", "/", false, 0);
  return out;
}

/** Accepted components that no reference chain from root reaches (any tab, any template, Button labels): never drawn. */
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
  }
  return Object.keys(surface.components).filter((id) => surface.components[id].status === "ok" && !reached.has(id));
}

function visibleBlocks(nodes: Node[]): number {
  return nodes.filter((n) => !n.inList && !CONTAINERS.has(typeOf(n.entry))).length;
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

// ── One turn ──────────────────────────────────────────────────────────────────

type StepResult = {
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
};

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

function evaluate(job: Job, run: number, step: number, st: StoreApi, agent: AgentItem, expect: ScenarioExpect | undefined, notes: string[]): StepResult {
  const state = st.getState();
  const events: Timed[] = state.recordings[agent.turnId]?.events ?? [];
  const m = agent.metrics;
  const reasons: string[] = [];
  const fetches = m.fetches ?? [];
  // Demo sources answer in 0 ms; only live web searches belong in the search columns.
  const searches = fetches.filter((f) => f.source === "search");
  const result: StepResult = {
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
  };
  for (const f of fetches) {
    if (!f.ok) notes.push(`${f.source} failed: ${f.error ?? "unknown"}`);
    else if (f.source !== "search") notes.push(`demo ${f.source}: ${f.records}`);
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
      result.blocks = visibleBlocks(nodes);
      if (!nodes.some((n) => n.entry.status === "ok")) reasons.push("nothing rendered from root");
      if (result.blocks > MAX_BLOCKS) reasons.push(`${result.blocks} visible blocks`);
      const lost = orphans(surface);
      if (lost.length) notes.push(`not reachable from root: ${lost.join(", ")}`);
      if (expect?.bricks || expect?.data) {
        const types = new Set<string>(Object.values(surface.components).flatMap((c) => (c.status === "ok" ? [c.def.component] : [])));
        const missing = (expect.bricks ?? []).filter((b) => !types.has(b));
        const wrongData = Object.entries(expect.data ?? {}).filter(([path, v]) => !sameJson(getAt(surface.data, path), v));
        result.expectOk = missing.length === 0 && wrongData.length === 0;
        if (missing.length) notes.push(`expected bricks missing: ${missing.join(", ")}`);
        if (wrongData.length) notes.push(`expected data differs at ${wrongData.map(([p]) => p).join(", ")}`);
      }
    }
    if (expect?.patchOnly) {
      const usage = events.some((e) => e.ev.type === "usage");
      if (m.route?.decision !== "patch") reasons.push(`route ${m.route ? `${m.route.decision} (${m.route.reason})` : "missing"}, expected patch`);
      if (usage) reasons.push("LLM was called (usage event)");
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
    const prev = runs.get(key) ?? { group: r.job.group, ok: true };
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
  ].filter((l): l is string => l !== null);
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
  const client = createTurnClient({
    store: st,
    // The browser's apiFetch, against another origin.
    fetch: (path, init) => {
      const headers = new Headers(init.headers);
      headers.set("x-demo-key", key);
      if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
      return fetch(opts.baseUrl + path, { ...init, headers });
    },
  });
  let blocked: string | null = null;
  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i];
    const notes: string[] = [];
    if (blocked) {
      const r: StepResult = {
        job, run, step: i, status: "not run", reasons: [blocked], notes, firstUi: null, screen: null, data: null, done: null,
        outTokens: null, searchMs: null, records: null, blocks: null, route: null, expectOk: null, model: null,
      };
      results.push(r);
      printResult(r);
      continue;
    }
    const before = lastAgent(st);
    if ("say" in step) {
      await client.sendTurn({ input: { type: "utterance", text: step.say }, display: step.say, via: "text" });
    } else {
      const s = st.getState();
      const surface = s.newestSurfaceId ? s.surfaces[s.newestSurfaceId] : undefined;
      const target = surface ? findTapTarget(surface, step.tap) : null;
      if (!surface || !target) {
        const r: StepResult = {
          job, run, step: i, status: "fail", reasons: [`no OptionCard/Button action starting with "${step.tap}" on the newest surface`], notes,
          firstUi: null, screen: null, data: null, done: null, outTokens: null, searchMs: null, records: null, blocks: null, route: null, expectOk: null, model: null,
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
    const r = evaluate(job, run, i, st, agent, step.expect, notes);
    results.push(r);
    printResult(r);
    if (opts.raw) {
      mkdirSync(opts.raw, { recursive: true });
      const rec = st.getState().recordings[agent.turnId];
      writeFileSync(join(opts.raw, `${job.mode}-${job.id}-run${run + 1}-step${i + 1}.json`), JSON.stringify({ input: agent.retry.input, ...rec }, null, 1));
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
    `- a2ui: every scenario (all steps) and five held-out lines, ${opts.runs}× each, decision model on. widgets and html: each scenario's opening line once, in the modes it lists.`,
    "- Pass: at least one component rendered (widgets: a widget or text; html: a page); 0 refused and 0 validation errors in the real client processor; ≤ 7 visible blocks; no error; patchOnly steps: route decision patch and no usage event.",
    "- Visible block: a component reachable from root in render order, except layout containers (Card, Column, Row, Tabs; first tab only). A List is one block, a Button one, a refused placeholder one.",
    "- first UI: the turn's surface has a root (patch steps: the first knob change). screen done: last composer or knob line, caption, widget or html. data arrived: last live data event. Search ms is the Worker's own measure (the longest search of the turn); records are summed over the turn's searches.",
    "- Medians with (min–max). \"–\" means not measured. \"expect\" counts the scenario's expected bricks/data (informational, not part of pass).",
    "",
    `**${passed}/${results.length} lines pass.**`,
    "",
    ...checks,
    "",
    table,
    "",
  ].join("\n");
  writeFileSync(opts.out, md);
  console.log("\n" + checks.join("\n") + "\n\n" + table + `\n\nWrote ${opts.out}`);
  process.exitCode = passed === results.length ? 0 : 1;
}

await main();
