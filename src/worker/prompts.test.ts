import { describe, expect, test } from "bun:test";
import { BRICKS } from "@shared/catalog";
import type { TurnRequest } from "@shared/protocol";
import { COMPOSER_SYSTEM_PROMPT, composerPrompt, HTML_INSTRUCTION, htmlPrompt, promptContext, widgetsPrompt } from "./prompts";

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

  test("every example line is valid JSON", () => {
    const example = COMPOSER_SYSTEM_PROMPT.slice(COMPOSER_SYSTEM_PROMPT.indexOf("EXAMPLE"));
    const jsonLines = example.split("\n").filter((l) => l.startsWith("{"));
    expect(jsonLines.length).toBe(6);
    for (const l of jsonLines) expect(() => JSON.parse(l)).not.toThrow();
  });

  test("DATA asks for live search, never fixed places; its example lines are valid JSON", () => {
    const data = COMPOSER_SYSTEM_PROMPT.slice(COMPOSER_SYSTEM_PROMPT.indexOf("\nDATA\n"), COMPOSER_SYSTEM_PROMPT.indexOf("DESIGN RULES"));
    expect(COMPOSER_SYSTEM_PROMPT).toContain('{"data": {"source":"search"|"flights"');
    expect(data).toContain("search  args {query, fields, max?}");
    expect(data).toContain("Never search for flights");
    expect(COMPOSER_SYSTEM_PROMPT).not.toContain("places  args");
    expect(COMPOSER_SYSTEM_PROMPT).not.toContain("walk_min");
    const lines = data.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{"));
    expect(lines.length).toBe(4);
    for (const l of lines) expect(() => JSON.parse(l)).not.toThrow();
    const search = JSON.parse(lines[0]);
    expect(search.data).toMatchObject({ source: "search", into: "/results", args: { fields: ["name", "subtitle", "tags"] } });
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
