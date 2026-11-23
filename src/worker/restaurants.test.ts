import { describe, expect, test } from "bun:test";
import type { JsonObject } from "@shared/a2ui";
import { promptContext } from "./prompts";
import { clockTime, PLACE_FIELDS, placeQuery, priceLevel, recordsToPlaces, restaurantProps, restaurantSearch, walkMinutes } from "./restaurants";
import { DEFAULT_SEARCH_ITEMS, searchPrompt } from "./search";

const now = new Date("2026-11-25T18:30:00Z");
const withAddress = promptContext(
  { venue: "JAAI (Just Add AI), Überseestadt", city: "Bremen", address: "Konsul-Smidt-Straße 8p, 28217 Bremen", catalogId: "http://h/catalog/brick-box/v1" },
  now,
);
const noAddress = promptContext({ venue: "JAAI (Just Add AI), Überseestadt", city: "Bremen", catalogId: "http://h/catalog/brick-box/v1" }, now);

describe("placeQuery", () => {
  test("coerces numeric strings, ignores junk, clamps a long kind", () => {
    expect(placeQuery({ kind: " vegan ", max_walk_min: "10" })).toEqual({ kind: "vegan", max_walk_min: 10 });
    expect(placeQuery({ kind: 3, max_walk_min: "x" })).toEqual({});
    expect(placeQuery({ max_walk_min: 0 })).toEqual({});
    expect(placeQuery({})).toEqual({});
    expect(placeQuery({ kind: "a ".repeat(80) }).kind?.length).toBeLessThanOrEqual(60);
  });
});

describe("restaurantSearch", () => {
  test("kind + venue address, the widget's fields, the default item cap", () => {
    expect(restaurantSearch({ kind: "vegan" }, withAddress)).toEqual({
      query: "vegan restaurants near Konsul-Smidt-Straße 8p, 28217 Bremen",
      fields: [...PLACE_FIELDS],
      max: DEFAULT_SEARCH_ITEMS,
    });
    expect(PLACE_FIELDS).toEqual(["name", "kind", "walk_min", "price_level", "tags", "opens_until"]);
  });

  test("no kind → restaurants; a kind that names a place is not doubled; no address → venue and city", () => {
    expect(restaurantSearch({}, withAddress).query).toBe("restaurants near Konsul-Smidt-Straße 8p, 28217 Bremen");
    expect(restaurantSearch({ kind: "pub" }, withAddress).query).toBe("pub near Konsul-Smidt-Straße 8p, 28217 Bremen");
    expect(restaurantSearch({ kind: "Italian restaurant" }, withAddress).query).toBe("Italian restaurant near Konsul-Smidt-Straße 8p, 28217 Bremen");
    expect(restaurantSearch({}, noAddress).query).toBe("restaurants near JAAI (Just Add AI), Überseestadt, Bremen");
    const otherCity = promptContext({ venue: "V", city: "Bremen", address: "Hafenstraße 1", catalogId: "x" }, now);
    expect(restaurantSearch({}, otherCity).query).toBe("restaurants near Hafenstraße 1, Bremen");
  });

  test("the walking limit stays out of the query (results rarely state it; the search would drop everything)", () => {
    expect(restaurantSearch({ kind: "sushi", max_walk_min: 5 }, withAddress).query).toBe("sushi restaurants near Konsul-Smidt-Straße 8p, 28217 Bremen");
  });

  test("the search prompt tells the model each widget field is null unless stated", () => {
    const p = searchPrompt(restaurantSearch({}, withAddress), withAddress);
    expect(p.user).toContain("- walk_min: walking minutes from the person's location as a number, only if a result states it");
    expect(p.user).toContain('- price_level: the number of currency signs');
    expect(p.user).toContain('- opens_until: closing time on the person\'s day (see Now) as "HH:mm"');
    expect(p.user).toContain("Now: Wednesday 2026-11-25, 19:30 (Europe/Berlin).");
    expect(p.system).toContain("null for anything the search results do not state");
  });
});

describe("recordsToPlaces", () => {
  const rec = (over: JsonObject): JsonObject => ({
    id: "r1",
    name: "Feuerwache",
    kind: "german",
    walk_min: null,
    price_level: null,
    tags: ["beer", "terrace"],
    opens_until: null,
    source: "https://feuerwache.example/",
    ...over,
  });

  test("keeps nulls as null: nothing is estimated or defaulted", () => {
    expect(recordsToPlaces([rec({})])).toEqual([
      { id: "r1", name: "Feuerwache", kind: "german", walk_min: null, price_level: null, tags: ["beer", "terrace"], opens_until: null, source: "https://feuerwache.example/" },
    ]);
    expect(recordsToPlaces([rec({ kind: null, tags: null })])[0]).toMatchObject({ kind: "", tags: [] });
  });

  test("stated values are kept in the widget's shapes", () => {
    const [p] = recordsToPlaces([rec({ walk_min: "7 min", price_level: "€€", opens_until: "9:30" })]);
    expect(p).toMatchObject({ walk_min: 7, price_level: 2, opens_until: "09:30" });
  });

  test("rows without a name are dropped; so is a stated walk over the limit, never an unknown one", () => {
    const rows = [rec({ id: "r1", name: null }), rec({ id: "r2", walk_min: 12 }), rec({ id: "r3", walk_min: 4 }), rec({ id: "r4" })];
    expect(recordsToPlaces(rows, 10).map((p) => p.id)).toEqual(["r3", "r4"]);
    expect(recordsToPlaces(rows).map((p) => p.id)).toEqual(["r2", "r3", "r4"]);
  });

  test("coercers accept only stated, unambiguous values", () => {
    expect([7, "7", "7 min", "7 minutes walk", "12 mins"].map(walkMinutes)).toEqual([7, 7, 7, 7, 12]);
    expect([0, -3, 7.5, 500, "about 7 min", "1.2 km", "5-10 min", null, true].map(walkMinutes)).toEqual(Array(9).fill(null));
    expect([1, 4, "€", "€€€€", "$$", "3"].map(priceLevel)).toEqual([1, 4, 1, 4, 2, 3]);
    expect([0, 5, 2.5, "€€–€€€", "cheap", "€€€€€", null].map(priceLevel)).toEqual(Array(7).fill(null));
    expect(["22:00", "9:30", "24:00", " 23:59 "].map(clockTime)).toEqual(["22:00", "09:30", "24:00", "23:59"]);
    expect(["10 pm", "22 Uhr", "25:00", "24:30", "22:60", 22, null].map(clockTime)).toEqual(Array(7).fill(null));
  });
});

describe("restaurantProps", () => {
  const place = (walk: number | null) => ({ id: "r1", name: "A", kind: "", walk_min: walk, price_level: null, tags: [], opens_until: null });

  test("kind is echoed; the walking limit only when every row states a walking time", () => {
    expect(restaurantProps([place(4), place(8)], { kind: "vegan", max_walk_min: 10 })).toEqual({ places: [place(4), place(8)], kind: "vegan", max_walk_min: 10 });
    expect(restaurantProps([place(4), place(null)], { max_walk_min: 10 })).toEqual({ places: [place(4), place(null)] });
    expect(restaurantProps([], { max_walk_min: 10 })).toEqual({ places: [] });
  });
});
