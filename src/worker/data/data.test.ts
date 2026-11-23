import { describe, expect, test } from "bun:test";
import { DATA_SOURCES, resolveData } from "./index";
import { generateFlights, isIsoDate } from "./flights";

const defaults = { from: "Bremen", date: "2026-11-24" };

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

  test("long-haul destinations get long flights", () => {
    for (const f of generateFlights("Bremen", "New York", "2026-11-24")) {
      const minutes = (Date.parse(f.arrive + "Z") - Date.parse(f.depart + "Z")) / 60_000;
      expect(minutes).toBeGreaterThanOrEqual(480);
    }
    for (const f of generateFlights("Bremen", "Lisbon", "2026-11-24")) {
      const minutes = (Date.parse(f.arrive + "Z") - Date.parse(f.depart + "Z")) / 60_000;
      expect(minutes).toBeLessThanOrEqual(240 + 140 + 15);
    }
  });

  test("isIsoDate", () => {
    expect(isIsoDate("2026-11-24")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("tomorrow")).toBe(false);
  });
});

describe("resolveData", () => {
  test("there is no fixed places source: only search and flights exist", () => {
    expect(DATA_SOURCES).toEqual(["search", "flights"]);
    expect(resolveData({ source: "places", args: { kind: "vegan" } }, defaults)).toEqual({ ok: false, error: 'unknown data source "places"' });
  });

  test("flights with defaults for from and date", () => {
    const res = resolveData({ source: "flights", args: { to: "New York" } }, defaults);
    if (!res.ok || res.source !== "flights") throw new Error("expected flights");
    expect(res.records).toEqual(generateFlights("Bremen", "New York", "2026-11-24"));
    expect(res.query).toBe("Bremen → New York 2026-11-24");
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
