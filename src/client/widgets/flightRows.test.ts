import { describe, expect, test } from "bun:test";
import { emptyFlightsText, flightRowParts, parseFlightSearchProps } from "./flightRows";

const live = {
  id: "r1",
  carrier: "Lufthansa",
  route: "BRE → JFK · 1 stop via FRA",
  price: "from €476",
  tags: ["round trip", "Nov fares"],
  source: "https://www.lufthansa.example/fares",
};

describe("parseFlightSearchProps", () => {
  test("live rows pass through; unknown route and price stay null (no time, no computed price)", () => {
    const { flights } = parseFlightSearchProps({ flights: [live, { carrier: "KLM" }] });
    expect(flights[0]).toEqual(live);
    expect(flights[1]).toEqual({ id: "flight-1", carrier: "KLM", route: null, price: null, tags: [] });
  });

  test("rows without a carrier go; only http(s) sources become links; non-string tags are dropped", () => {
    const { flights } = parseFlightSearchProps({
      flights: [
        { ...live, source: "javascript:alert(1)", tags: ["ok", 3, null, " "] },
        { ...live, id: "r2", carrier: " ", source: "https://x.example/" },
        { ...live, id: "r3", carrier: null },
        "not a row",
        { ...live, id: "r4", route: "", price: "  ", source: "not a url" },
      ],
    });
    expect(flights.map((f) => [f.id, f.route, f.price, f.tags, f.source])).toEqual([
      ["r1", live.route, live.price, ["ok"], undefined],
      ["r4", null, null, live.tags, undefined],
    ]);
  });

  test("the old demo shape (depart/arrive/price_eur, no carrier text) yields no rows", () => {
    const demo = { id: "f1", from: "Bremen", to: "New York", depart: "2026-11-26T07:15", arrive: "2026-11-26T15:45", stops: 0, price_eur: 164, demo: true };
    expect(parseFlightSearchProps({ flights: [demo] }).flights).toEqual([]);
  });

  test("form values pass through; junk is dropped", () => {
    expect(parseFlightSearchProps({ flights: [], from: "Bremen", to: "Oslo", date: "2026-11-26" })).toEqual({ flights: [], from: "Bremen", to: "Oslo", date: "2026-11-26" });
    expect(parseFlightSearchProps({ from: 3, to: " " })).toEqual({ flights: [], from: undefined, to: undefined, date: undefined });
  });
});

describe("flightRowParts and the empty state", () => {
  test("a row shows route, fare as listed, at most 3 tags and the source host", () => {
    const [f] = parseFlightSearchProps({ flights: [{ ...live, tags: ["a", "b", "c", "d"] }] }).flights;
    expect(flightRowParts(f)).toEqual({ route: live.route, price: "from €476", tags: ["a", "b", "c"], host: "lufthansa.example" });
  });

  test("a row of nulls shows only the carrier's facts that are known", () => {
    const [f] = parseFlightSearchProps({ flights: [{ carrier: "KLM" }] }).flights;
    expect(flightRowParts(f)).toEqual({ route: null, price: null, tags: [], host: null });
  });

  test("'No flights found.' only once a search could run", () => {
    expect(emptyFlightsText({ from: "Bremen", to: "Oslo" })).toBe("No flights found.");
    expect(emptyFlightsText({ from: "Bremen" })).toBe("No results yet.");
  });
});
