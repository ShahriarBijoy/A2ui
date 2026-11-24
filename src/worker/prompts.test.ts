import { describe, expect, test } from "bun:test";
import { BRICKS } from "@shared/catalog";
import { ICON_NAMES } from "@shared/icons";
import type { TurnRequest } from "@shared/protocol";
import { COMPOSER_SYSTEM_PROMPT, composerUnreachableNote, composerPrompt, HTML_INSTRUCTION, htmlPrompt, promptContext, widgetsPrompt } from "./prompts";

const ctx = promptContext({ venue: "Venue", city: "Bremen", catalogId: "http://h/catalog/brick-box/v1" }, new Date("2026-11-23T18:55:00Z"));
const req: TurnRequest = {
  mode: "a2ui",
  decision: false,
  input: { type: "utterance", text: "I need to book a flight tomorrow." },
  thread: [{ role: "user", text: "hi" }, { role: "agent", text: "Hello screen" }],
  surface: { id: "s1", components: [{ id: "root", component: "Card" }], data: { trip: { to: "" } }, knobs: [] },
  nextSurfaceId: "s2",
};

describe("promptContext", () => {
  test("date, weekday, time and tomorrow in Europe/Berlin", () => {
    expect(ctx).toMatchObject({ date: "2026-11-23", weekday: "Monday", time: "19:55", tomorrow: "2026-11-24", tomorrowWeekday: "Tuesday" });
  });

  test("DEV_NOW (local venue time) replaces the clock; a malformed value is ignored", () => {
    const at = (devNow: string) => promptContext({ venue: "", city: "", catalogId: "", devNow }, new Date("2026-11-23T18:55:00Z"));
    expect(at("2026-11-25T18:45")).toMatchObject({ date: "2026-11-25", weekday: "Wednesday", time: "18:45", tomorrow: "2026-11-26", tomorrowWeekday: "Thursday" });
    expect(at(" 2026-11-30T23:59:30 ")).toMatchObject({ date: "2026-11-30", time: "23:59", tomorrow: "2026-12-01", tomorrowWeekday: "Tuesday" });
    for (const bad of ["tomorrow", "2026-02-30T10:00", "2026-11-25T24:00", "2026-11-25"]) {
      expect(at(bad)).toMatchObject({ date: "2026-11-23", weekday: "Monday", time: "19:55" });
    }
    expect(at("")).toMatchObject({ date: "2026-11-23", time: "19:55" });
  });

  test("UTC evening already counts as the next day in Bremen; month rollover", () => {
    const c = promptContext({ venue: "", city: "", catalogId: "" }, new Date("2026-11-30T23:30:00Z"));
    expect(c).toMatchObject({ date: "2026-12-01", weekday: "Tuesday", time: "00:30", tomorrow: "2026-12-02" });
  });
});

describe("composer prompt", () => {
  test("static system prompt: every brick, the function list, no volatile values", () => {
    for (const b of BRICKS) expect(COMPOSER_SYSTEM_PROMPT).toContain(`  ${b.name}: `);
    expect(COMPOSER_SYSTEM_PROMPT).toContain("formatString{value}");
    expect(COMPOSER_SYSTEM_PROMPT).toContain("${/booking/guests} guests");
    expect(COMPOSER_SYSTEM_PROMPT).not.toContain("2026-");
    expect(COMPOSER_SYSTEM_PROMPT).not.toContain("http");
    expect(COMPOSER_SYSTEM_PROMPT).not.toContain("undefined");
  });

  test("composer prompt names every icon and the data-only rule for Image and Rating", () => {
    const lines = COMPOSER_SYSTEM_PROMPT.split("\n");
    const at = lines.findIndex((l) => l.startsWith("ICONS ("));
    expect(at).toBeGreaterThan(-1);
    expect(lines[at + 1].trim()).toBe(ICON_NAMES.join(", "));
    expect(lines[at]).toContain("leave icon out when none fits");
    const flat = COMPOSER_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(flat).toContain('Image.url and Rating.value only from a data line\'s fields: request "image" or "rating" in its fields');
    expect(flat).toContain("Never write a URL or a rating yourself.");
    expect(flat).toContain("Anything the person picks stays an OptionCard in a List; never put choices in a Table.");
    expect(flat).toContain("each counts toward the 7 visible blocks");
    expect(flat).toContain("rating, image (a photo, for an Image), carrier and route (trips)");
    // The 7-block design rule is still there.
    expect(flat).toContain("At most 7 visible blocks.");
  });

  test("every example line is valid JSON", () => {
    const example = COMPOSER_SYSTEM_PROMPT.slice(COMPOSER_SYSTEM_PROMPT.indexOf("EXAMPLE"));
    const jsonLines = example.split("\n").filter((l) => l.startsWith("{"));
    expect(jsonLines.length).toBe(6);
    for (const l of jsonLines) expect(() => JSON.parse(l)).not.toThrow();
  });

  test("DATA asks for live search, never fixed places; its example lines are valid JSON", () => {
    const data = COMPOSER_SYSTEM_PROMPT.slice(COMPOSER_SYSTEM_PROMPT.indexOf("\nDATA\n"), COMPOSER_SYSTEM_PROMPT.indexOf("DESIGN RULES"));
    expect(COMPOSER_SYSTEM_PROMPT).toContain('{"data": {"source":"search","args":{...},"into":"/pointer"}}');
    expect(data).toContain("search  args {query, fields, max?}");
    expect(COMPOSER_SYSTEM_PROMPT).not.toContain("places  args");
    expect(COMPOSER_SYSTEM_PROMPT).not.toContain("walk_min");
    const lines = data.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
    expect(lines.length).toBe(5);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    const search = JSON.parse(lines[0]);
    expect(search.data).toMatchObject({ source: "search", into: "/results", args: { fields: ["name", "subtitle", "tags"] } });
  });

  test("flights come from live search: no demo source, a trip gate, a search example with carrier/route/price/tags", () => {
    const data = COMPOSER_SYSTEM_PROMPT.slice(COMPOSER_SYSTEM_PROMPT.indexOf("\nDATA\n"), COMPOSER_SYSTEM_PROMPT.indexOf("DESIGN RULES"));
    const flat = COMPOSER_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(flat).not.toContain('"flights"|');
    expect(flat).not.toContain("flights args");
    expect(flat).not.toContain("Never search for flights");
    expect(flat).not.toContain("price_eur");
    expect(flat).not.toContain("depart");
    expect(flat.toLowerCase()).not.toContain("demo data");
    // The gate that turns "I need to book a flight tomorrow." into a form: no destination, no data line.
    expect(flat).toContain("A trip search (flight, train, bus) needs the origin, the destination and the date; ask for a missing one first.");
    expect(flat).toContain("for a trip, the origin, the destination, the weekday and the date");
    expect(flat).toContain("carrier and route (trips)");
    const lines = data.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
    const flights = JSON.parse(lines[3]);
    expect(flights.data).toEqual({
      source: "search",
      args: { query: "flights from Porto to Oslo on Saturday 15 June 2030", fields: ["carrier", "route", "price", "tags"], max: 4 },
      into: "/flights",
    });
    const card = JSON.parse(lines[4]);
    expect(card).toMatchObject({
      component: "OptionCard",
      title: { "@path": "carrier" },
      subtitle: { "@path": "route" },
      tags: { "@path": "tags" },
      price: { "@path": "price" },
      action: { event: { name: "pick_flight", context: { id: { "@path": "id" }, carrier: { "@path": "carrier" }, route: { "@path": "route" }, price: { "@path": "price" } } } },
    });
    // The example is another trip: the talk's route and date never sit in the cached prompt (owner rule).
    expect(flat).not.toMatch(/Bremen|New York|JFK|\bBRE\b|\bFRA\b|Lufthansa|Air France|KLM|\bNov\b|November/);
  });

  test("a request that implies a time names the day and time from STATE in its search query", () => {
    const data = COMPOSER_SYSTEM_PROMPT.slice(COMPOSER_SYSTEM_PROMPT.indexOf("\nDATA\n"), COMPOSER_SYSTEM_PROMPT.indexOf("DESIGN RULES"));
    const flat = data.replace(/\s+/g, " ");
    expect(flat).toContain("When the request implies a time of day");
    expect(flat).toContain("never earlier than STATE.time when it is today");
    for (const field of ["STATE.weekday", "STATE.date", "STATE.time", "STATE.tomorrow_weekday", "STATE.tomorrow"]) expect(data).toContain(field);
    // The system prompt is cached, so the real date must come from STATE, never from the prompt text.
    expect(COMPOSER_SYSTEM_PROMPT).not.toMatch(/\b2026-\d{2}-\d{2}\b/);
  });

  test("structure rules: reachable ids, new content is a new step, value shapes, STATE defaults, not-available screen", () => {
    const flat = COMPOSER_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(flat).toContain("every id you send must appear in the child, children, tabs or Accordion items of a component that is itself reachable from \"root\", or it will not render");
    expect(flat).toContain("A request for a new kind of content to choose from (options, results, a list of items) is a new step");
    expect(flat).toContain("ChoicePicker a string array");
    expect(flat).toContain("When the person did not say one but STATE implies it, use it");
    expect(flat).toContain("still gets a screen, always");
    expect(flat).toContain("Never answer it with a caption alone");
  });

  test("search only for local, current or changing facts; general knowledge is written directly", () => {
    const flat = COMPOSER_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(flat).toContain("Use a data line only for facts that are local, current or changing");
    expect(flat).toContain("you write yourself as literals; never search it");
    // No demo-line echoes in the prefill examples.
    expect(flat).not.toContain("we're six");
    expect(flat).not.toContain('"from Bremen"');
  });

  test("decision steps end with one primary Button; assigned places are picked before the confirm step", () => {
    const flat = COMPOSER_SYSTEM_PROMPT.replace(/\s+/g, " ");
    expect(flat).toContain("Every step that needs a decision ends with one primary Button");
    expect(flat).toContain("Only a final summary or receipt step may end without one");
    expect(flat).toContain(
      "When the person books something with assigned places (seats), let them pick the place with the most specific component before the confirm step; then end that step with one primary Button whose action context carries the chosen place.",
    );
    // Seat availability is a fact no source states: the seat map is a generic cabin.
    expect(flat).toContain(
      'A SeatMap shows a generic cabin: no "taken" seats (seat availability is unknown) and no preselected seat (initial value ""); its confirm Button keeps a required check on the seat.',
    );
  });

  test("the unreachable-List note hands back the requested data paths", () => {
    const note = composerUnreachableNote(["list", "item"], ["/results"]);
    expect(note).toContain("not reachable from root, so the requested data did not show: list, item");
    expect(note).toContain("The data for /results is already requested and arriving");
    expect(note).toContain("do not send a data line for it again");
  });

  test("the venue address goes into STATE only when configured", () => {
    expect(JSON.parse(composerPrompt(req, ctx).user.split("\n")[1])).not.toHaveProperty("venue_address");
    const withAddress = promptContext({ venue: "Venue", city: "Bremen", address: " Konsul-Smidt-Straße 8p ", catalogId: "c" });
    expect(withAddress.address).toBe("Konsul-Smidt-Straße 8p");
    expect(JSON.parse(composerPrompt(req, withAddress).user.split("\n")[1])).toMatchObject({ venue: "Venue", venue_address: "Konsul-Smidt-Straße 8p", city: "Bremen" });
    expect(promptContext({ venue: "V", city: "C", address: "  ", catalogId: "c" })).not.toHaveProperty("address");
  });

  test("STATE, THREAD and INPUT go in the user message; system is cached", () => {
    const p = composerPrompt(req, ctx);
    expect(p.system).toBe(COMPOSER_SYSTEM_PROMPT);
    expect(p.cacheSystem).toBe(true);
    const state = JSON.parse(p.user.split("\n")[1]);
    expect(state).toMatchObject({
      date: "2026-11-23",
      tomorrow: "2026-11-24",
      catalog_id: "http://h/catalog/brick-box/v1",
      current_surface_id: "s1",
      next_surface_id: "s2",
      current_components: [{ id: "root", component: "Card" }],
      current_data: { trip: { to: "" } },
    });
    expect(p.user).toContain("user: hi\nagent: Hello screen");
    expect(p.user.endsWith('The person said: "I need to book a flight tomorrow."')).toBe(true);
  });

  test("a tap is described with its name and context", () => {
    const tap: TurnRequest = {
      ...req,
      input: { type: "action", action: { name: "pick_place", surfaceId: "s1", sourceComponentId: "place", timestamp: "t", context: { id: "p3" } } },
    };
    expect(composerPrompt(tap, ctx).user).toContain('The person tapped: pick_place {"id":"p3"}');
  });
});

describe("other modes", () => {
  test("widgets prompt carries the date and venue in the user message", () => {
    const p = widgetsPrompt(req, ctx);
    expect(p.system).toContain("exactly two widgets");
    expect(p.user).toContain("Tomorrow is 2026-11-24");
    expect(p.user).toContain("Venue, Bremen");
  });

  test("html prompt is exactly the instruction plus the request, no system prompt", () => {
    const p = htmlPrompt(req);
    expect(p.system).toBeUndefined();
    expect(p.user).toBe(`${HTML_INSTRUCTION}\n\nRequest: I need to book a flight tomorrow.`);
  });
});
