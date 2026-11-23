/**
 * Live data for "search" data lines (owner direction: no fixed data). A second Claude call with the
 * web search server tool runs beside the compose stream. Its answer is untrusted text: only records
 * that parse, carry a source the search actually returned, and hold at least one requested fact
 * reach the client. Unknown facts stay null; nothing is estimated here or in the prompt.
 */
import { isPlainObject, type JsonObject, type JsonValue } from "@shared/a2ui";
import { describeLlmError, type Prompt, type SearchReply, type WebSearch } from "./claude";
import type { PromptContext } from "./prompts";

/** Measured: one search answers in ~4–8 s; the client gives up after 25 s. */
export const SEARCH_TIMEOUT_MS = 12_000;
export const MAX_SEARCH_ITEMS = 6;
export const DEFAULT_SEARCH_ITEMS = 5;
/** Used when the composer names no usable fields: what an OptionCard template usually binds. */
export const DEFAULT_SEARCH_FIELDS: readonly string[] = ["name", "subtitle", "tags"];
/** "id" and "source" are added by the server, so the composer cannot ask the search for them. */
const SERVER_FIELDS = new Set(["id", "source"]);
const MAX_FIELDS = 8;
const MAX_QUERY_CHARS = 300;
const MAX_TEXT_CHARS = 200;
const MAX_TAG_CHARS = 40;
const MAX_TAGS = 5;
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

export type SearchRequest = { query: string; fields: string[]; max: number };

export type SearchOutcome =
  | { ok: true; records: JsonObject[]; dropped: number; searches: number; inputTokens: number; outputTokens: number }
  | { ok: false; error: string; searches?: number; inputTokens?: number; outputTokens?: number };

// ── Args ──────────────────────────────────────────────────────────────────────

export function parseSearchArgs(args: JsonObject): { ok: true; req: SearchRequest } | { ok: false; error: string } {
  const query = typeof args.query === "string" ? args.query.trim().replace(/\s+/g, " ") : "";
  if (!query) return { ok: false, error: "search: missing 'query'" };
  const fields: string[] = [];
  if (Array.isArray(args.fields)) {
    for (const f of args.fields) {
      if (typeof f !== "string") continue;
      const name = f.trim();
      if (FIELD_NAME.test(name) && !SERVER_FIELDS.has(name) && !fields.includes(name)) fields.push(name);
    }
  }
  const rawMax = typeof args.max === "string" ? Number(args.max) : args.max;
  const max = typeof rawMax === "number" && Number.isFinite(rawMax) ? Math.min(MAX_SEARCH_ITEMS, Math.max(1, Math.round(rawMax))) : DEFAULT_SEARCH_ITEMS;
  return {
    ok: true,
    req: {
      query: query.slice(0, MAX_QUERY_CHARS),
      fields: fields.length > 0 ? fields.slice(0, MAX_FIELDS) : [...DEFAULT_SEARCH_FIELDS],
      max,
    },
  };
}

// ── Prompt ────────────────────────────────────────────────────────────────────

/** Static, so the request-specific parts (date, place, keys) live in the user message. */
export const SEARCH_SYSTEM_PROMPT = `You look up real-world facts for a live app that shows them as a list of cards.
Use the web_search tool once, then answer.

ANSWER
Only a JSON array: no text before or after it, no markdown fences. Each item is an object with exactly
the keys the request lists, plus "source".
- source: the URL of the search result that states the item's facts.
- Every value is a short string, a number, an array of short strings, or null.
- null for anything the search results do not state. Never estimate, round or guess a number, price,
  time, date, distance or rating.
- Only items that meet the whole request. If it names a time, date, place, price or condition
  ("open tonight", "next month", "dog-friendly"), leave out items the results do not show meeting it.
  Fewer items, or [], is a correct answer.
- One item per real thing (a place, an event, a route, a product), never a list page or an article.
- English, at most 80 characters per string.`;

/** What well-known keys mean; any other key is filled by its name. */
const FIELD_HINTS: Record<string, string> = {
  name: "the item's own name",
  title: "the item's own name",
  subtitle: 'one line with the 1-3 facts most useful for choosing, each stated by a result, joined with " · "',
  detail: "one short sentence about the item, stated by a result",
  description: "one short sentence about the item, stated by a result",
  tags: "1-3 short labels (kind, cuisine, feature)",
  price: 'the price as written in the result, with currency (e.g. "€25", "from €39")',
  date: '"YYYY-MM-DD"',
  time: '"HH:mm"',
  hours: "opening hours for the requested day, as written in the result",
  address: "the street address as written in the result",
  venue: "where it takes place",
  rating: 'the rating as written in the result (e.g. "4.5/5")',
  distance: "the distance as written in the result",
};

export function searchPrompt(req: SearchRequest, ctx: PromptContext): Prompt {
  const where = [ctx.venue, ctx.address, ctx.city].filter((s): s is string => Boolean(s && s.trim())).join(", ");
  const keys = [...req.fields.map((f) => (FIELD_HINTS[f] ? `${f}: ${FIELD_HINTS[f]}` : f)), "source: URL"];
  const user = [
    `Now: ${ctx.weekday} ${ctx.date}, ${ctx.time} (Europe/Berlin).${where ? ` The person is at ${where}.` : ""}`,
    `Request: ${req.query}`,
    `Keys:\n${keys.map((k) => `- ${k}`).join("\n")}`,
    `At most ${req.max} items.`,
  ].join("\n");
  return { system: SEARCH_SYSTEM_PROMPT, user };
}

// ── Reply ─────────────────────────────────────────────────────────────────────

/** Runs one search. Never throws: every failure becomes { ok: false, error }. */
export async function runSearch(req: SearchRequest, webSearch: WebSearch, ctx: PromptContext, signal: AbortSignal): Promise<SearchOutcome> {
  try {
    return parseSearchReply(await webSearch(searchPrompt(req, ctx), signal), req);
  } catch (err) {
    return { ok: false, error: describeLlmError(err, "Search failed") };
  }
}

export function parseSearchReply(reply: SearchReply, req: SearchRequest): SearchOutcome {
  const metrics = { searches: reply.searches, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens };
  const fail = (error: string): SearchOutcome => ({ ok: false, error, ...metrics });
  if (reply.stopReason === "refusal") return fail("Claude declined the search");
  if (reply.stopReason === "max_tokens") return fail("search answer cut off (max_tokens)");
  if (reply.stopReason !== "end_turn") return fail(`search stopped early (${reply.stopReason ?? "no stop reason"})`);
  // Without a search the answer would come from the model's memory: not live data.
  if (reply.searches < 1) return fail("no web search was made");
  const urls = reply.blocks.flatMap((b) => (b.type === "results" ? b.urls : []));
  if (urls.length === 0) {
    const codes = reply.blocks.flatMap((b) => (b.type === "search_error" ? [b.code] : []));
    return fail(codes.length ? `web search failed (${codes.join(", ")})` : "web search returned no results");
  }
  // The text before the search is a preamble ("I'll search for ..."); the answer follows the last result.
  let last = -1;
  reply.blocks.forEach((b, i) => {
    if (b.type !== "text") last = i;
  });
  const answer = reply.blocks
    .slice(last + 1)
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");
  const items = extractJsonArray(answer);
  if (!items) return fail("answer was not a JSON array");
  const hosts = new Set(urls.map(hostOf).filter((h): h is string => h !== null));
  const { records, dropped } = normalizeRecords(items, req.fields, req.max, hosts);
  return { ok: true, records, dropped, ...metrics };
}

/**
 * The JSON array in a reply that may wrap it in prose or a fence. Tries the outermost brackets, then
 * each "[" in turn with a string-aware bracket match, so prose like "[1]" around it does not break it.
 * A cut-off or invalid array returns null.
 */
export function extractJsonArray(text: string): JsonValue[] | null {
  const tryParse = (s: string): JsonValue[] | null => {
    try {
      const v: unknown = JSON.parse(s);
      return Array.isArray(v) && (v.length === 0 || v.some(isPlainObject)) ? (v as JsonValue[]) : null;
    } catch {
      return null;
    }
  };
  const first = text.indexOf("[");
  const lastClose = text.lastIndexOf("]");
  if (first < 0 || lastClose < first) return null;
  const outer = tryParse(text.slice(first, lastClose + 1));
  if (outer) return outer;
  let tries = 0;
  for (let i = first; i >= 0 && tries < 20; i = text.indexOf("[", i + 1), tries++) {
    const end = matchingBracket(text, i);
    if (end < 0) continue;
    const got = tryParse(text.slice(i, end + 1));
    if (got) return got;
  }
  return null;
}

/** Index of the "]" closing the "[" at `start`, skipping strings; -1 if it never closes. */
function matchingBracket(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return ch === "]" ? i : -1;
      if (depth < 0) return -1;
    }
  }
  return -1;
}

/**
 * Keeps only the requested fields, coerced to string | number | string[] | null, plus a source the
 * search returned (by host) and an id r1..rN. Items with no requested fact are dropped.
 */
export function normalizeRecords(
  items: JsonValue[],
  fields: readonly string[],
  max: number,
  allowedHosts: ReadonlySet<string>,
): { records: JsonObject[]; dropped: number } {
  const records: JsonObject[] = [];
  let dropped = 0;
  for (const item of items) {
    if (records.length >= max) break;
    if (!isPlainObject(item)) {
      dropped++;
      continue;
    }
    const source = httpUrl(item.source);
    const host = source ? hostOf(source) : null;
    if (!source || !host || !allowedHosts.has(host)) {
      dropped++;
      continue;
    }
    const rec: JsonObject = { id: `r${records.length + 1}` };
    let facts = 0;
    for (const f of fields) {
      const v = coerceField(item[f] as JsonValue | undefined);
      rec[f] = v;
      if (v !== null) facts++;
    }
    if (facts === 0) {
      dropped++;
      continue;
    }
    rec.source = source;
    records.push(rec);
  }
  return { records, dropped };
}

export function coerceField(v: JsonValue | undefined): string | number | string[] | null {
  if (typeof v === "string") return clipText(v, MAX_TEXT_CHARS);
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (Array.isArray(v)) {
    const out = v
      .map((x) => (typeof x === "string" ? clipText(x, MAX_TAG_CHARS) : typeof x === "number" && Number.isFinite(x) ? String(x) : null))
      .filter((x): x is string => x !== null)
      .slice(0, MAX_TAGS);
    return out.length > 0 ? out : null;
  }
  // Booleans and objects have no slot in a card; the prompt asks for strings and numbers.
  return null;
}

function clipText(s: string, n: number): string | null {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t || /^(null|n\/a|unknown)$/i.test(t)) return null;
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
}

function httpUrl(v: JsonValue | undefined): string | null {
  if (typeof v !== "string") return null;
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}
