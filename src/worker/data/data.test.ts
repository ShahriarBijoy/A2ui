import { describe, expect, test } from "bun:test";
import { findPlaces, matchesKind, PLACES, placeQuery, resolveData } from "./index";
import { generateFlights, isIsoDate } from "./flights";

const defaults = { from: "Bremen", date: "2026-11-24" };

describe("places.json", () => {
  test("8 placeholder records, Place-shaped, marked TODO", () => {
    expect(PLACES).toHaveLength(8);
    const kinds = new Set(PLACES.map((p) => p.kind));
    expect(kinds.size).toBe(8);
    for (const p of PLACES) {
      expect(p.name.endsWith(" (TODO)")).toBe(true);
      expect(p.walk_min).toBeGreaterThanOrEqual(2);
      expect(p.walk_min).toBeLessThanOrEqual(14);
      expect(p.price_level).toBeGreaterThanOrEqual(1);
      expect(p.price_level).toBeLessThanOrEqual(4);
      expect(p.tags.length).toBeGreaterThanOrEqual(2);
      expect(p.tags.length).toBeLessThanOrEqual(3);
      expect(p.opens_until).toMatch(/^\d{2}:\d{2}$/);
      expect(Object.keys(p).sort()).toEqual(["id", "kind", "name", "opens_until", "price_level", "tags", "walk_min"]);
    }
  });
});

describe("findPlaces", () => {
  test("no filter: sorted by walk_min, at most 6", () => {
    const res = findPlaces({});
    expect(res).toHaveLength(6);
    const walks = res.map((p) => p.walk_min);
    expect(walks).toEqual([...walks].sort((a, b) => a - b));
  });

  test("max_walk_min filters", () => {
    const res = findPlaces({ max_walk_min: 5 });
    expect(res.length).toBeGreaterThanOrEqual(2);
    expect(res.every((p) => p.walk_min <= 5)).toBe(true);
  });

  test("kind matches kind or tags, case-insensitive", () => {
    expect(matchesKind(PLACES.find((p) => p.kind === "italian")!, "ITAL")).toBe(true);
    expect(matchesKind(PLACES.find((p) => p.kind === "pub")!, "late")).toBe(true);
    expect(matchesKind(PLACES.find((p) => p.kind === "vegan")!, "italian food")).toBe(false);
    const late = findPlaces({ kind: "late" });
    expect(late.length).toBeGreaterThanOrEqual(2);
    expect(late.every((p) => p.tags.includes("late"))).toBe(true);
  });

  test("fewer than 2 matches: relaxes, keeps the exact match on top, never empty", () => {
    const res = findPlaces({ kind: "italian" });
    expect(res[0].kind).toBe("italian");
    expect(res.length).toBeGreaterThanOrEqual(2);
    const none = findPlaces({ kind: "ethiopian", max_walk_min: 1 });
    expect(none.length).toBeGreaterThanOrEqual(2);
  });

  test("relaxes walk before kind", () => {
    // Only the sushi place (14 min) is sushi; with max 5 min nothing strict matches.
    const res = findPlaces({ kind: "sushi", max_walk_min: 5 });
    expect(res.length).toBeGreaterThanOrEqual(2);
    expect(res.every((p) => p.walk_min <= 5)).toBe(true);
  });

  test("placeQuery coerces numeric strings and ignores junk", () => {
    expect(placeQuery({ kind: " vegan ", max_walk_min: "10" })).toEqual({ kind: "vegan", max_walk_min: 10 });
    expect(placeQuery({ kind: 3, max_walk_min: "x" })).toEqual({ kind: "3" });
    expect(placeQuery({})).toEqual({});
  });
});

describe("flights", () => {
  test("deterministic for the same from|to|date", () => {
    expect(generateFlights("Bremen", "New York", "2026-11-24")).toEqual(generateFlights("bremen ", "NEW YORK", "2026-11-24").map((f) => ({ ...f, from: "Bremen", to: "New York" })));
    expect(generateFlights("Bremen", "New York", "2026-11-24")).not.toEqual(generateFlights("Bremen", "New York", "2026-11-25"));
  });

  test("4 options, ids f1..f4, all demo, plausible fields", () => {
    for (const [from, to, date] of [["Bremen", "New York", "2026-11-24"], ["Hamburg", "Lisbon", "2026-12-31"], ["A", "B", "2027-02-28"]]) {
      const flights = generateFlights(from, to, date);
      expect(flights.map((f) => f.id)).toEqual(["f1", "f2", "f3", "f4"]);
      const carriers = new Set(flights.map((f) => f.carrier));
      expect(carriers.size).toBe(4);
      for (const f of flights) {
        expect(f.demo).toBe(true);
        expect(f.from).toBe(from);
        expect(f.to).toBe(to);
        expect(f.depart.startsWith(date + "T")).toBe(true);
        expect(f.depart).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
        expect(f.arrive > f.depart).toBe(true);
        expect([0, 1]).toContain(f.stops);
        expect(f.price_eur).toBeGreaterThanOrEqual(89);
        expect(f.price_eur).toBeLessThanOrEqual(640);
        expect(Number.isInteger(f.price_eur)).toBe(true);
      }
      const departs = flights.map((f) => f.depart);
      expect(departs).toEqual([...departs].sort());
    }
  });

  test("isIsoDate", () => {
    expect(isIsoDate("2026-11-24")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("tomorrow")).toBe(false);
  });
});

describe("resolveData", () => {
  test("places", () => {
    const res = resolveData({ source: "places", args: { kind: "vegan" } }, defaults);
    expect(res.ok && res.source === "places" && res.records[0].kind).toBe("vegan");
  });

  test("flights with defaults for from and date", () => {
    const res = resolveData({ source: "flights", args: { to: "New York" } }, defaults);
    if (!res.ok || res.source !== "flights") throw new Error("expected flights");
    expect(res.records).toEqual(generateFlights("Bremen", "New York", "2026-11-24"));
  });

  test("flights accepts a date-time and falls back on a bad date", () => {
    const a = resolveData({ source: "flights", args: { from: "Bremen", to: "Oslo", date: "2026-11-30T10:00" } }, defaults);
    const b = resolveData({ source: "flights", args: { from: "Bremen", to: "Oslo", date: "tomorrow" } }, defaults);
    if (!a.ok || a.source !== "flights" || !b.ok || b.source !== "flights") throw new Error("expected flights");
    expect(a.records[0].depart.startsWith("2026-11-30")).toBe(true);
    expect(b.records[0].depart.startsWith("2026-11-24")).toBe(true);
  });

  test("errors: unknown source, flights without 'to'", () => {
    expect(resolveData({ source: "hotels", args: {} }, defaults).ok).toBe(false);
    expect(resolveData({ source: "flights", args: { from: "Bremen" } }, defaults).ok).toBe(false);
  });
});
