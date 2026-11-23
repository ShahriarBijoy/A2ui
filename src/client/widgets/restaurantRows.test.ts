import { describe, expect, test } from "bun:test";
import type { Place } from "@shared/protocol";
import { parseRestaurantProps, placeRowParts } from "./restaurantRows";

const live = {
  id: "r1",
  name: "Feuerwache",
  kind: "german",
  walk_min: null,
  price_level: null,
  tags: ["beer"],
  opens_until: null,
  source: "https://www.feuerwache.example/menu",
};

describe("parseRestaurantProps", () => {
  test("unknown facts stay null (no default walk or price)", () => {
    const { places } = parseRestaurantProps({ places: [live, { name: "Bare" }] });
    expect(places[0]).toEqual(live);
    expect(places[1]).toEqual({ id: "place-1", name: "Bare", kind: "", walk_min: null, price_level: null, tags: [], opens_until: null });
  });

  test("out-of-range values are unknown; only http(s) sources become links; nameless rows go", () => {
    const { places } = parseRestaurantProps({
      places: [
        { ...live, walk_min: 0, price_level: 7, source: "javascript:alert(1)" },
        { ...live, id: "r2", price_level: 2.5, opens_until: " ", source: "not a url" },
        { ...live, id: "r3", name: null },
      ],
    });
    expect(places.map((p: Place) => [p.id, p.walk_min, p.price_level, p.opens_until, p.source])).toEqual([
      ["r1", null, null, null, undefined],
      ["r2", null, null, null, undefined],
    ]);
  });

  test("filters pass through", () => {
    expect(parseRestaurantProps({ places: [], kind: "vegan", max_walk_min: 10 })).toEqual({ places: [], kind: "vegan", max_walk_min: 10 });
    expect(parseRestaurantProps({})).toEqual({ places: [], kind: undefined, max_walk_min: undefined });
  });
});

describe("placeRowParts", () => {
  test("a row of nulls shows only what is known: no 'null', no minutes, no price, no hours", () => {
    const [p] = parseRestaurantProps({ places: [live] }).places;
    const parts = placeRowParts(p);
    expect(parts).toEqual({ meta: "german", price: null, walk: null, host: "feuerwache.example" });
    expect(JSON.stringify(parts)).not.toContain("null\"");
  });

  test("no kind and no hours → empty meta, never a leading separator", () => {
    const [p] = parseRestaurantProps({ places: [{ ...live, kind: null, source: null }] }).places;
    expect(placeRowParts(p)).toEqual({ meta: "", price: null, walk: null, host: null });
  });

  test("stated values are shown", () => {
    const [p] = parseRestaurantProps({ places: [{ ...live, walk_min: 6, price_level: 2, opens_until: "23:00" }] }).places;
    expect(placeRowParts(p)).toEqual({ meta: "german · open until 23:00", price: "€€", walk: "6 min", host: "feuerwache.example" });
  });
});
