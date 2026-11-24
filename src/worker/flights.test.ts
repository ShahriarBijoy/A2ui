import { describe, expect, test } from "bun:test";
import { FLIGHT_FIELDS, flightProps, flightQuery, flightSearch, isIsoDate, longDate, recordsToFlights } from "./flights";
import { promptContext } from "./prompts";
import { searchPrompt } from "./search";

describe("flightQuery", () => {
  test("trims the ends, keeps only a real date (a date-time still names the day), ignores junk", () => {
    expect(flightQuery({ from: " Bremen ", to: "New  York", date: "2026-11-26" })).toEqual({ from: "Bremen", to: "New York", date: "2026-11-26" });
    expect(flightQuery({ from: "Bremen", to: "Oslo", date: "2026-11-26T09:00" })).toEqual({ from: "Bremen", to: "Oslo", date: "2026-11-26" });
    expect(flightQuery({ from: 3, to: "  ", date: "tomorrow" })).toEqual({});
    expect(flightQuery({ to: "x".repeat(200) }).to?.length).toBeLessThanOrEqual(60);
  });

  test("an origin the person did not name is the venue's city; a named one wins; no destination is ever filled in", () => {
    expect(flightQuery({ to: "New York", date: "2026-11-26" }, "Bremen")).toEqual({ from: "Bremen", to: "New York", date: "2026-11-26" });
    expect(flightQuery({ from: "Hamburg", to: "Oslo" }, "Bremen")).toEqual({ from: "Hamburg", to: "Oslo" });
    expect(flightQuery({ from: " " }, "Bremen")).toEqual({ from: "Bremen" });
    expect(flightQuery({}, " ")).toEqual({});
  });
});

describe("flightSearch", () => {
  test("a trip query with the long date, the row fields and 4 items", () => {
    expect(flightSearch({ from: "Bremen", to: "New York", date: "2026-11-26" })).toEqual({
      query: "flights from Bremen to New York on Thursday 26 November 2026",
      fields: ["carrier", "route", "price", "tags"],
      max: 4,
    });
    // No date given: the query names none rather than assume one.
    expect(flightSearch({ from: "Bremen", to: "Oslo" })?.query).toBe("flights from Bremen to Oslo");
  });

  test("no search without both ends: nothing guesses an origin or a destination", () => {
    expect(flightSearch({ from: "Bremen" })).toBeNull();
    expect(flightSearch({ to: "Oslo", date: "2026-11-26" })).toBeNull();
  });

  test("every row field carries a search hint", () => {
    const ctx = promptContext({ venue: "V", city: "Bremen", catalogId: "c" }, new Date("2026-11-25T17:45:00Z"));
    const user = searchPrompt({ query: "q", fields: [...FLIGHT_FIELDS], max: 4 }, ctx).user;
    for (const f of FLIGHT_FIELDS) expect(user).toMatch(new RegExp(`^- ${f}: \\S`, "m"));
  });
});

describe("recordsToFlights", () => {
  test("null-safe: unknown route and price stay null, tags default to [], rows without a carrier go", () => {
    const flights = recordsToFlights([
      { id: "r1", carrier: " Lufthansa ", route: "BRE → JFK · 1 stop via FRA", price: "from €476", tags: ["round trip", 3, " "], source: "https://lh.example/" },
      { id: "r2", carrier: "KLM", route: null, price: null, tags: null, source: "https://klm.example/" },
      { id: "r3", carrier: null, route: "BRE → JFK", price: "€99", tags: null },
      { id: "r4", carrier: "", price: "€1" },
      { carrier: "Air France", price: 460, tags: "1 stop" },
    ]);
    expect(flights).toEqual([
      { id: "r1", carrier: "Lufthansa", route: "BRE → JFK · 1 stop via FRA", price: "from €476", tags: ["round trip"], source: "https://lh.example/" },
      { id: "r2", carrier: "KLM", route: null, price: null, tags: [], source: "https://klm.example/" },
      { id: "r3", carrier: "Air France", route: null, price: "460", tags: ["1 stop"] },
    ]);
    expect(recordsToFlights([])).toEqual([]);
  });
});

describe("flightProps, dates", () => {
  test("props carry the rows and only the form values given", () => {
    expect(flightProps([], {})).toEqual({ flights: [] });
    expect(flightProps([], { from: "Bremen", to: "Oslo", date: "2026-11-26" })).toEqual({ flights: [], from: "Bremen", to: "Oslo", date: "2026-11-26" });
  });

  test("isIsoDate and longDate", () => {
    expect(isIsoDate("2026-11-26")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("tomorrow")).toBe(false);
    expect(longDate("2026-11-26")).toBe("Thursday 26 November 2026");
    expect(longDate("2030-06-15")).toBe("Saturday 15 June 2030");
    expect(longDate("soon")).toBe("soon");
  });
});
