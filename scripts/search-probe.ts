/**
 * Live probe for the search data line: one Claude call with the web search server tool, timed, with
 * the raw content block sequence saved for parser fixtures. Keys come from .dev.vars.
 *   bun run scripts/search-probe.ts <outDir> [runs] [tool]
 * tool: web_search_20250305 (default) | web_search_20260209
 */
import Anthropic from "@anthropic-ai/sdk";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const vars = Object.fromEntries(
  readFileSync(".dev.vars", "utf8")
    .split(/\r?\n/)
    .map((l) => /^([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1], m[2]]),
);
const [outDir = "probe-out", runsArg = "1", toolArg = "web_search_20250305"] = process.argv.slice(2);
const runs = Number(runsArg);
const tool = toolArg === "web_search_20260209" ? "web_search_20260209" : "web_search_20250305";
mkdirSync(outDir, { recursive: true });

const client = new Anthropic({ apiKey: vars.ANTHROPIC_API_KEY, maxRetries: 0 });
const queries = [
  "Restaurants open for dinner tonight (Monday 2026-11-23) near Überseestadt, Bremen",
  "Concerts in Hamburg in December 2026",
  "Dog-friendly hikes near Bremen",
];
const fields = ["name", "subtitle", "tags"];
const system = `Return ONLY a JSON array (at most 5 items) of objects with exactly these keys: ${fields.join(", ")}, source.
source is the URL of the page that states the item. Use null for anything the sources do not state. Never estimate numbers.`;

for (let i = 0; i < runs; i++) {
  for (const [qi, query] of queries.entries()) {
    const t0 = performance.now();
    try {
      const msg = await client.messages.create({
        model: vars.LLM_MODEL || "claude-haiku-5-5",
        max_tokens: 3000,
        thinking: { type: "disabled" },
        system,
        messages: [{ role: "user", content: `Today is Monday 2026-11-23. Request: ${query}` }],
        tools: [{ type: tool, name: "web_search", max_uses: 1 }],
      });
      const ms = Math.round(performance.now() - t0);
      const shape = msg.content.map((b) => (b.type === "text" ? `text(${b.text.length}${b.citations?.length ? ",cites" : ""})` : b.type));
      console.log(JSON.stringify({ tool, query: qi, ms, stop: msg.stop_reason, usage: msg.usage, shape }));
      writeFileSync(join(outDir, `${tool}-q${qi}-r${i}.json`), JSON.stringify({ ms, msg }, null, 1));
    } catch (err) {
      console.log(JSON.stringify({ tool, query: qi, ms: Math.round(performance.now() - t0), error: String(err) }));
    }
  }
}
