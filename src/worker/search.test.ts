import { describe, expect, test } from "bun:test";
import type Anthropic from "@anthropic-ai/sdk";
import type { JsonValue } from "@shared/a2ui";
import { SEARCH_TOOL, toSearchReply, type SearchReply } from "./claude";
import { promptContext } from "./prompts";
import {
  coerceField,
  DEFAULT_SEARCH_FIELDS,
  extractJsonArray,
  normalizeRecords,
  parseSearchArgs,
  parseSearchReply,
  runSearch,
  SEARCH_SYSTEM_PROMPT,
  searchPrompt,
  type SearchRequest,
} from "./search";
// A real reply (Haiku 5.5, web_search_20250305, max_uses 1), trimmed: preamble text, two parallel
// queries (the second refused with max_uses_exceeded), then prose and a fenced JSON array.
import fixture from "./fixtures/search-reply.json";

const realMessage = fixture as unknown as Anthropic.Message;
const req: SearchRequest = { query: "Restaurants open for dinner tonight near Überseestadt, Bremen", fields: ["name", "subtitle", "tags"], max: 5 };
const ctx = promptContext(
  { venue: "JAAI (Just Add AI), Überseestadt", city: "Bremen", address: "Konsul-Smidt-Straße 8p", catalogId: "http://h/catalog/brick-box/v1" },
  new Date("2026-11-23T19:15:00Z"),
);
const reply = (over: Partial<SearchReply> = {}): SearchReply => ({ ...toSearchReply(realMessage), ...over });

describe("toSearchReply (real response shape)", () => {
  test("keeps text, result URLs and result errors in order; reads the measured counts", () => {
    const r = toSearchReply(realMessage);
    expect(r.blocks.map((b) => b.type)).toEqual(["text", "results", "search_error", "text"]);
    expect(r.blocks[2]).toEqual({ type: "search_error", code: "max_uses_exceeded" });
    expect(r).toMatchObject({ stopReason: "end_turn", searches: 1, inputTokens: 15136, outputTokens: 876 });
  });

  test("the tool is the one measured: web_search_20250305, one use", () => {
    expect(SEARCH_TOOL).toEqual({ type: "web_search_20250305", name: "web_search", max_uses: 1 });
  });
});

describe("parseSearchReply", () => {
  test("preamble + fenced JSON after the last result → 5 sourced records with ids, only the requested keys", () => {
    const out = parseSearchReply(reply(), req);
    if (!out.ok) throw new Error(out.error);
    expect(out.records).toHaveLength(5);
    expect(out.records.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    for (const r of out.records) {
      expect(Object.keys(r)).toEqual(["id", "name", "subtitle", "tags", "source"]);
      expect(String(r.source)).toMatch(/^https:\/\//);
    }
    expect(out.records[1]).toMatchObject({ id: "r2", name: "The Grill Upper River", source: "https://www.the-grill-bremen.de/" });
    expect(out).toMatchObject({ dropped: 0, searches: 1, inputTokens: 15136, outputTokens: 876 });
  });

  test("the answer may be split over several text blocks (citations)", () => {
    const text = '[{"name":"A","subtitle":null,"tags":["x"],"source":"https://www.bremen.de/a"}]';
    const r = reply({ blocks: [{ type: "text", text: "Searching." }, { type: "results", urls: ["https://www.bremen.de/x"] }, { type: "text", text: text.slice(0, 20) }, { type: "text", text: text.slice(20) }] });
    const out = parseSearchReply(r, req);
    expect(out.ok && out.records).toEqual([{ id: "r1", name: "A", subtitle: null, tags: ["x"], source: "https://www.bremen.de/a" }]);
  });

  test("an empty array is a valid answer (nothing matched)", () => {
    const out = parseSearchReply(reply({ blocks: [{ type: "results", urls: ["https://a.de/"] }, { type: "text", text: "None are open tonight.\n[]" }] }), req);
    expect(out).toMatchObject({ ok: true, records: [] });
  });

  test("failures: stop reasons, no search, only errors, no JSON, cut-off JSON", () => {
    const err = (r: SearchReply) => {
      const out = parseSearchReply(r, req);
      return out.ok ? "ok" : out.error;
    };
    expect(err(reply({ stopReason: "max_tokens" }))).toBe("search answer cut off (max_tokens)");
    expect(err(reply({ stopReason: "refusal" }))).toBe("Claude declined the search");
    expect(err(reply({ stopReason: "pause_turn" }))).toBe("search stopped early (pause_turn)");
    expect(err(reply({ searches: 0 }))).toBe("no web search was made");
    expect(err(reply({ blocks: [{ type: "search_error", code: "too_many_requests" }, { type: "text", text: "[]" }] }))).toBe("web search failed (too_many_requests)");
    expect(err(reply({ blocks: [{ type: "text", text: "[]" }] }))).toBe("web search returned no results");
    const results = { type: "results" as const, urls: ["https://www.bremen.de/x"] };
    expect(err(reply({ blocks: [results, { type: "text", text: "I could not find anything reliable." }] }))).toBe("answer was not a JSON array");
    expect(err(reply({ blocks: [results, { type: "text", text: '[{"name":"A","source":"https://www.bremen.de/a"},{"name":"B' }] }))).toBe("answer was not a JSON array");
    // Failures still carry the measured counts.
    expect(parseSearchReply(reply({ searches: 0 }), req)).toMatchObject({ ok: false, searches: 0, inputTokens: 15136 });
  });

  test("a JSON array in the preamble (before the search) is ignored", () => {
    const r = reply({ blocks: [{ type: "text", text: '[{"name":"From memory","source":"https://a.de/"}]' }, { type: "results", urls: ["https://a.de/"] }, { type: "text", text: "Nothing found." }] });
    expect(parseSearchReply(r, req)).toMatchObject({ ok: false, error: "answer was not a JSON array" });
  });
});

describe("extractJsonArray", () => {
  test("bare, fenced, with prose around, with [1]-style brackets after", () => {
    const arr = '[{"name":"A","tags":["x","y"]}]';
    expect(extractJsonArray(arr)).toEqual([{ name: "A", tags: ["x", "y"] }]);
    expect(extractJsonArray("Here you go:\n```json\n" + arr + "\n```")).toEqual([{ name: "A", tags: ["x", "y"] }]);
    expect(extractJsonArray("Results [verified]: " + arr + " See [1] and [2].")).toEqual([{ name: "A", tags: ["x", "y"] }]);
    expect(extractJsonArray('[{"name":"has ] and [ in a string"}]')).toEqual([{ name: "has ] and [ in a string" }]);
  });

  test("no array, an array of strings only, cut-off or invalid JSON → null", () => {
    expect(extractJsonArray("no json here")).toBeNull();
    expect(extractJsonArray('["a","b"]')).toBeNull();
    expect(extractJsonArray('[{"name":"A","tags":["x","y"]},{"name":"B"')).toBeNull();
    expect(extractJsonArray("[{name: 'A'}]")).toBeNull();
  });
});

describe("normalizeRecords (field filter)", () => {
  const hosts = new Set(["bremen.de", "example.org"]);
  const fields = ["name", "price", "tags"];

  test("drops unknown keys, coerces values, adds ids r1..rN and keeps the source", () => {
    const items: JsonValue[] = [
      { name: "  A  place ", price: 25, tags: ["x", 3, null, { k: 1 }, "  "], extra: "dropped", id: "model-id", source: "https://www.bremen.de/a" },
      { name: "B", price: true, tags: "not an array", source: "http://example.org/b" },
    ];
    const { records, dropped } = normalizeRecords(items, fields, 5, hosts);
    expect(records).toEqual([
      { id: "r1", name: "A place", price: 25, tags: ["x", "3"], source: "https://www.bremen.de/a" },
      { id: "r2", name: "B", price: null, tags: "not an array", source: "http://example.org/b" },
    ]);
    expect(dropped).toBe(0);
  });

  test("missing requested keys become null; items without any fact, objects without a usable source, or a source the search did not return are dropped", () => {
    const items: JsonValue[] = [
      { name: "kept", source: "https://example.org/1" },
      { name: null, price: "n/a", tags: [], source: "https://example.org/2" },
      { name: "no source" },
      { name: "bad scheme", source: "javascript:alert(1)" },
      { name: "not a url", source: "example.org/3" },
      { name: "invented host", source: "https://made-up.example.com/" },
      "a string",
      ["an", "array"],
    ];
    const { records, dropped } = normalizeRecords(items, fields, 5, hosts);
    expect(records).toEqual([{ id: "r1", name: "kept", price: null, tags: null, source: "https://example.org/1" }]);
    expect(dropped).toBe(7);
  });

  test("a requested carrier is required: a trip item without one is dropped; other requests are unaffected", () => {
    const hosts = new Set(["a.example"]);
    const items = [
      { carrier: null, route: "BRE → JFK · 1 stop", price: "€590", source: "https://a.example/1" },
      { carrier: "KLM", route: null, price: null, source: "https://a.example/2" },
    ];
    const out = normalizeRecords(items, ["carrier", "route", "price"], 4, hosts);
    expect(out.dropped).toBe(1);
    expect(out.records).toEqual([{ id: "r1", carrier: "KLM", route: null, price: null, source: "https://a.example/2" }]);
    // Without a requested carrier the same item is kept (the KLM item then holds no requested fact).
    expect(normalizeRecords(items, ["route", "price"], 4, hosts).records.map((r) => r.route)).toEqual(["BRE → JFK · 1 stop"]);
  });

  test("caps at max; long text is clipped", () => {
    const items: JsonValue[] = Array.from({ length: 9 }, (_, i) => ({ name: "x".repeat(300) + i, source: `https://example.org/${i}` }));
    const { records } = normalizeRecords(items, ["name"], 3, hosts);
    expect(records.map((r) => r.id)).toEqual(["r1", "r2", "r3"]);
    expect(String(records[0].name)).toHaveLength(200);
    expect(String(records[0].name).endsWith("…")).toBe(true);
  });

  test("coerceField", () => {
    expect(coerceField(" a ")).toBe("a");
    expect(coerceField("")).toBeNull();
    expect(coerceField("unknown")).toBeNull();
    expect(coerceField(4.5)).toBe(4.5);
    expect(coerceField(false)).toBeNull();
    expect(coerceField({ a: 1 })).toBeNull();
    expect(coerceField(undefined)).toBeNull();
    expect(coerceField(["a", "b", "c", "d", "e", "f", "g"])).toEqual(["a", "b", "c", "d", "e"]);
  });
});

describe("parseSearchArgs", () => {
  test("filters fields: valid names only, no server-owned id/source, no duplicates, at most 8", () => {
    const r = parseSearchArgs({ query: " concerts  in Hamburg ", fields: ["name", "id", "source", "name", "bad key", 3, "date", "a", "b", "c", "d", "e", "f", "g"], max: 4 });
    expect(r).toEqual({ ok: true, req: { query: "concerts in Hamburg", fields: ["name", "date", "a", "b", "c", "d", "e", "f"], max: 4 } });
  });

  test("defaults: fields when none are usable, max 5; max is clamped to 1..6", () => {
    expect(parseSearchArgs({ query: "q" })).toEqual({ ok: true, req: { query: "q", fields: [...DEFAULT_SEARCH_FIELDS], max: 5 } });
    expect(parseSearchArgs({ query: "q", fields: ["id"], max: 50 })).toMatchObject({ req: { fields: [...DEFAULT_SEARCH_FIELDS], max: 6 } });
    expect(parseSearchArgs({ query: "q", max: "0" })).toMatchObject({ req: { max: 1 } });
  });

  test("a query is required; long queries are clipped", () => {
    expect(parseSearchArgs({ fields: ["name"] })).toEqual({ ok: false, error: "search: missing 'query'" });
    expect(parseSearchArgs({ query: "  " })).toEqual({ ok: false, error: "search: missing 'query'" });
    const r = parseSearchArgs({ query: "x".repeat(400) });
    expect(r.ok && r.req.query.length).toBe(300);
  });
});

describe("searchPrompt and runSearch", () => {
  test("static system prompt; the user message carries the date, the venue with its address, the query and the keys", () => {
    const p = searchPrompt(req, ctx);
    expect(p.system).toBe(SEARCH_SYSTEM_PROMPT);
    expect(p.system).toContain("null for anything the search results do not state");
    expect(p.system).toContain("Never estimate");
    expect(p.user).toContain("Now: Monday 2026-11-23, 20:15 (Europe/Berlin).");
    expect(p.user).toContain("The person is at JAAI (Just Add AI), Überseestadt, Konsul-Smidt-Straße 8p, Bremen.");
    expect(p.user).toContain(`Request: ${req.query}`);
    expect(p.user).toContain("- subtitle: one line with the 1-3 facts");
    expect(p.user).toContain("- source: URL");
    expect(p.user).toContain("At most 5 items.");
    expect(searchPrompt({ ...req, fields: ["lineup"] }, ctx).user).toContain("- lineup\n");
  });

  test("trips: carrier and route hints; a narrow exception to the date rule, fares labelled by tags, never estimated", () => {
    const user = searchPrompt({ ...req, fields: ["carrier", "route", "price", "tags"] }, ctx).user;
    expect(user).toContain("- carrier: the airline, rail or bus company name only, as a result states it");
    expect(user).toContain('- route: airports or cities and stops as a result states them, e.g. "OPO → OSL · 1 stop via AMS"; "nonstop" only if a result says so');
    const flat = SEARCH_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(flat).toContain("Trips (flights, trains, buses) are the one exception to that date rule");
    expect(flat).toContain("An item is one carrier or route that serves the requested trip, named by a result for this origin and destination");
    expect(flat).toContain('may be kept only with a tag that says what it is ("round trip", "June fares"); never present it as the fare for the requested date');
    expect(flat).toContain("No comments in values");
    // The general rules stay: the date rule for everything else, and no estimates.
    expect(flat).toContain("leave out items the results do not show meeting it");
    expect(flat).toContain("Never estimate, round or guess a number, price");
    expect(SEARCH_SYSTEM_PROMPT).not.toMatch(/\b20\d\d\b/);
    // No prompt text steers toward the stage scenario (owner rule): no talk place, carrier or date.
    const talk = /Bremen|New York|JFK|\bBRE\b|\bFRA\b|Lufthansa|Air France|KLM|\bNov\b|November/;
    expect(SEARCH_SYSTEM_PROMPT).not.toMatch(talk);
    // The user message names the venue by design; its field hints must not.
    for (const hint of user.split("\n").filter((l) => l.startsWith("- "))) expect(hint).not.toMatch(talk);
  });

  test("items whose stated hours contradict the requested day or time are left out", () => {
    expect(SEARCH_SYSTEM_PROMPT.replace(/\s+/g, " ")).toContain(
      "Leave out every item whose stated opening hours or dates contradict the requested day or time",
    );
  });

  test("runSearch never throws: a failing call becomes ok:false with a short message", async () => {
    const out = await runSearch(req, async () => {
      throw new Error("boom");
    }, ctx, new AbortController().signal);
    expect(out).toEqual({ ok: false, error: "Search failed: boom" });
    const good = await runSearch(req, async () => reply(), ctx, new AbortController().signal);
    expect(good.ok && good.records).toHaveLength(5);
  });
});
