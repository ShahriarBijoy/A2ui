/**
 * Live checks for search data lines against a running dev server (bun run dev -- --port 5179 --strictPort).
 * Per line: time to first UI, time to data, records, fetch outcome, and the A2UI replayed through the
 * client processor (refused messages, validation errors, template fields the records do not have).
 *   bun run scripts/live-search.ts [baseUrl] [outDir] [runs] [lines: search | opening]
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "@shared/a2ui";
import { isPlainObject } from "@shared/a2ui";
import type { TurnEvent } from "@shared/protocol";
import { OPENING_LINES } from "@shared/scenarios";
import { applyMessage } from "../src/client/a2ui/processor";
import type { SurfaceState } from "../src/client/state";

const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2]]),
);
const [baseUrl = "http://localhost:5179", outDir = "live-search-out", runsArg = "1", set = "search"] = process.argv.slice(2);
const runs = Number(runsArg) || 1;

/** The five held-out lines exist only as summaries in lane-W-report.md; this wording is reconstructed. */
const SEARCH_LINES = [
  "Plan a 3-day trip to Lisbon in March.",
  "Compare two phone plans for me.",
  "I want to adopt a dog. What do I need?",
  "Find a gift for my mum, around 50 euros.",
  "Book a haircut for Saturday morning.",
  "I want dinner after this event, pick a place nearby.",
  "Concerts in Hamburg next month.",
  "Dog-friendly hikes near Bremen.",
];
/** "opening", "search", or one literal line to repeat. */
const LINES = set === "opening" ? OPENING_LINES : set === "search" ? SEARCH_LINES : [set];

type Timed = { t: number; ev: TurnEvent };

async function turn(text: string): Promise<{ events: Timed[]; total: number }> {
  const body = { mode: "a2ui", decision: false, input: { type: "utterance", text }, thread: [], surface: null, nextSurfaceId: "s1" };
  const t0 = performance.now();
  const res = await fetch(`${baseUrl}/api/turn`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-demo-key": vars.DEMO_KEY ?? "" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const events: Timed[] = [];
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) events.push({ t: Math.round(performance.now() - t0), ev: JSON.parse(chunk.slice(6)) as TurnEvent });
    }
  }
  return { events, total: Math.round(performance.now() - t0) };
}

/** Relative @path fields read by templates of Lists bound to `into`, to compare with the record keys. */
function templateFields(surfaces: Record<string, SurfaceState>, into: string): string[] {
  const fields = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!isPlainObject(v)) return;
    if (typeof v["@path"] === "string" && !v["@path"].startsWith("/")) fields.add(v["@path"].split("/")[0]);
    if (v["@call"] === "formatString" && isPlainObject(v.args) && typeof v.args.value === "string") {
      for (const m of v.args.value.matchAll(/\$\{([^}/][^}]*)\}/g)) fields.add(m[1].split("/")[0]);
    }
    Object.values(v).forEach(walk);
  };
  for (const s of Object.values(surfaces)) {
    for (const entry of Object.values(s.components)) {
      if (entry.status !== "ok" || entry.def.component !== "List") continue;
      const children = (entry.def as { children?: unknown }).children;
      if (!isPlainObject(children) || children.path !== into || typeof children.componentId !== "string") continue;
      const tpl = s.components[children.componentId];
      if (tpl?.status === "ok") walk(tpl.def);
    }
  }
  return [...fields];
}

mkdirSync(outDir, { recursive: true });
const rows: Record<string, JsonValue>[] = [];
for (let run = 0; run < runs; run++) {
  for (const [li, text] of LINES.entries()) {
    let result: { events: Timed[]; total: number };
    try {
      result = await turn(text);
    } catch (err) {
      rows.push({ line: text, error: String(err) });
      continue;
    }
    const { events, total } = result;
    writeFileSync(join(outDir, `line${li}-run${run}.json`), JSON.stringify(events, null, 1));
    let surfaces: Record<string, SurfaceState> = {};
    let refused = 0;
    let validation = 0;
    for (const { ev } of events) {
      if (ev.type !== "a2ui") continue;
      const r = applyMessage(surfaces, ev.msg, { now: 0, turnId: "t" });
      surfaces = r.surfaces;
      refused += r.refused;
      validation += r.errors.length;
    }
    const firstUi = events.find((e) => e.ev.type === "a2ui" && e.ev.origin === "llm");
    const usage = events.find((e) => e.ev.type === "usage")?.ev as Extract<TurnEvent, { type: "usage" }> | undefined;
    const fetches = events.filter((e) => e.ev.type === "fetch");
    const errors = events.filter((e) => e.ev.type === "error").map((e) => (e.ev as { message: string }).message);
    const fetchRows = fetches.map(({ t, ev }) => {
      const f = ev as Extract<TurnEvent, { type: "fetch" }>;
      // The data event just before the fetch event names the path; compare its records with the template.
      const idx = events.findIndex((e) => e.ev === ev);
      const data = events[idx - 1]?.ev;
      const upd = data?.type === "a2ui" && "updateDataModel" in data.msg ? data.msg.updateDataModel : null;
      const recs = Array.isArray(upd?.value) ? upd.value : [];
      const keys = new Set(recs.flatMap((r) => (isPlainObject(r) ? Object.keys(r) : [])));
      const tpl = upd?.path ? templateFields(surfaces, upd.path) : [];
      const nulls = recs.reduce<number>((n, r) => n + (isPlainObject(r) ? Object.values(r).filter((v) => v === null).length : 0), 0);
      return {
        t_data: t,
        source: f.source,
        query: f.query,
        ok: f.ok,
        records: f.records,
        fetch_ms: f.ms,
        searches: f.searches ?? null,
        in_tok: f.input_tokens ?? null,
        out_tok: f.output_tokens ?? null,
        error: f.error ?? null,
        null_fields: nulls,
        template_fields: tpl,
        missing_in_records: recs.length ? tpl.filter((k) => !keys.has(k)) : [],
      };
    });
    const row = {
      line: text,
      run,
      t_first_ui: firstUi?.t ?? null,
      server_first_ui_ms: usage?.first_ui_ms ?? null,
      compose_ms: usage?.compose_ms ?? null,
      t_done: total,
      skipped: usage?.skipped_lines ?? null,
      repaired: usage?.repaired_lines ?? null,
      refused,
      validation_errors: validation,
      errors,
      fetches: fetchRows,
      bricks: [...new Set(Object.values(surfaces).flatMap((s) => Object.values(s.components).flatMap((c) => (c.status === "ok" ? [c.def.component] : []))))],
    };
    rows.push(row as unknown as Record<string, JsonValue>);
    console.log(JSON.stringify(row));
  }
}
writeFileSync(join(outDir, "summary.json"), JSON.stringify(rows, null, 1));
