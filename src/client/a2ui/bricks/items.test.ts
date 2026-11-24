import { describe, expect, test } from "bun:test";
import { areaGeometry, barWidths, iconView, imageView, parseRating, resolveItems, thinLabels, withUnit } from "./items";

describe("resolveItems", () => {
  const data = { plans: [{ id: "a", name: "A", price: null }, { id: "b", name: "B", price: "€10" }], empty: [], text: "x", trips: [{ legs: [{ title: "Fly" }] }] };

  test("a literal array is its items", () => {
    expect(resolveItems([{ label: "A", value: 1 }], data, "/", false)).toEqual({ kind: "items", items: [{ label: "A", value: 1 }] });
  });

  test("a path with no data is a skeleton while streaming and empty after", () => {
    expect(resolveItems({ "@path": "/missing" }, data, "/", true)).toEqual({ kind: "skeleton" });
    expect(resolveItems({ "@path": "/missing" }, data, "/", false)).toEqual({ kind: "empty" });
  });

  test("an empty list, a non-list value or an empty literal is empty, streaming or not", () => {
    expect(resolveItems({ "@path": "/empty" }, data, "/", true)).toEqual({ kind: "empty" });
    expect(resolveItems({ "@path": "/text" }, data, "/", true)).toEqual({ kind: "empty" });
    expect(resolveItems([], data, "/", true)).toEqual({ kind: "empty" });
  });

  test("null cells stay null", () => {
    const r = resolveItems({ "@path": "/plans" }, data, "/", false);
    expect(r).toEqual({ kind: "items", items: data.plans });
    if (r.kind === "items") expect(r.items[0].price).toBeNull();
  });

  test("a relative path reads the template item; items that are not objects are dropped", () => {
    expect(resolveItems({ "@path": "legs" }, data, "/trips/0", false)).toEqual({ kind: "items", items: [{ title: "Fly" }] });
    expect(resolveItems([1, null, { title: "Ok" }, "x"], data, "/", false)).toEqual({ kind: "items", items: [{ title: "Ok" }] });
  });
});

describe("parseRating", () => {
  test("reads the value and its scale", () => {
    expect(parseRating("4.5/5")).toEqual({ value: 4.5, max: 5 });
    expect(parseRating(4.2)).toEqual({ value: 4.2, max: 5 });
    expect(parseRating("8.7/10")).toEqual({ value: 8.7, max: 10 });
    expect(parseRating("4,6 / 5")).toEqual({ value: 4.6, max: 5 });
    expect(parseRating("4.3 out of 5")).toEqual({ value: 4.3, max: 5 });
    expect(parseRating("4.4")).toEqual({ value: 4.4, max: 5 });
    expect(parseRating(7, 10)).toEqual({ value: 7, max: 10 });
  });

  test("anything else is no rating", () => {
    for (const v of ["great", "", "4.5 stars from 1,203 reviews", null, undefined, true, -1, 6, "6/5", "3/0", [4], { value: 4 }]) {
      expect(parseRating(v as Parameters<typeof parseRating>[0])).toBeNull();
    }
    expect(parseRating(4.2, 4)).toBeNull();
  });
});

describe("barWidths", () => {
  test("percent of the largest", () => {
    expect(barWidths([50, 100, 25])).toEqual([50, 100, 25]);
    expect(barWidths([3])).toEqual([100]);
  });
  test("all zero, empty or negative: zeros", () => {
    expect(barWidths([0, 0])).toEqual([0, 0]);
    expect(barWidths([])).toEqual([]);
    expect(barWidths([-5, 10])).toEqual([0, 100]);
  });
});

describe("imageView", () => {
  test("no url (null, empty or not http(s)): nothing at all, even while the turn streams (no box that later collapses)", () => {
    for (const url of ["", "javascript:alert(1)", "data:image/png;base64,AAAA", "/relative.jpg"]) {
      expect(imageView(url, "loading")).toBe("hidden");
      expect(imageView(url, "loaded")).toBe("hidden");
    }
  });
  test("a url: the box holds a skeleton until the picture loads", () => {
    expect(imageView("https://example.test/a.jpg", "loading")).toBe("skeleton");
    expect(imageView("https://example.test/a.jpg", "loaded")).toBe("image");
  });
  test("a url that fails to load hides the brick (no broken-image icon)", () => {
    expect(imageView("https://example.test/404.jpg", "failed")).toBe("hidden");
  });
});

describe("iconView (Icon name literal or bound)", () => {
  const data = { weather: { now: { icon: "rain" }, days: [{ icon: "sun" }, { icon: "rocket" }, { icon: null }] } };

  test("a literal name in the set draws; anything else draws nothing", () => {
    expect(iconView("plane", data, "/", true)).toBe("plane");
    expect(iconView("rocket", data, "/", false)).toBeNull();
  });

  test("an absolute or template-relative binding draws the name it reads, when it is in the set", () => {
    expect(iconView({ "@path": "/weather/now/icon" }, data, "/", false)).toBe("rain");
    expect(iconView({ "@path": "icon" }, data, "/weather/days/0", false)).toBe("sun");
    expect(iconView({ "@path": "icon" }, data, "/weather/days/1", true)).toBeNull();
    expect(iconView({ "@path": "icon" }, data, "/weather/days/2", true)).toBeNull();
  });

  test("a binding whose data has not arrived is pending while streaming, nothing after", () => {
    expect(iconView({ "@path": "/weather/later/icon" }, data, "/", true)).toBe("pending");
    expect(iconView({ "@path": "/weather/later/icon" }, data, "/", false)).toBeNull();
    expect(iconView({ "@path": "/weather/now/icon" }, null, "/", true)).toBe("pending");
  });
});

describe("areaGeometry (Chart type area)", () => {
  test("one scale from min to max: max at the top pad, min at the bottom pad, the midpoint between", () => {
    const g = areaGeometry([-4, 1, -1.5]);
    expect(g.ticks).toEqual([
      { value: 1, y: 8 },
      { value: -1.5, y: 50 },
      { value: -4, y: 92 },
    ]);
    expect(g.points).toEqual([
      { x: 0, y: 92 },
      { x: 50, y: 8 },
      { x: 100, y: 50 },
    ]);
    expect(g.line).toBe("M0,92 L50,8 L100,50");
    expect(g.area).toBe("M0,92 L50,8 L100,50 L100,100 L0,100 Z");
  });

  test("all-negative and all-positive series fill the same height (not scaled from zero)", () => {
    const cold = areaGeometry([-10, -6, -8]).points.map((p) => p.y);
    const warm = areaGeometry([20, 24, 22]).points.map((p) => p.y);
    expect(cold).toEqual(warm);
    expect(Math.max(...cold) - Math.min(...cold)).toBe(84);
  });

  test("a flat series is a level line through the middle with one label; one point sits in the middle", () => {
    const flat = areaGeometry([3, 3, 3, 3]);
    expect(flat.ticks).toEqual([{ value: 3, y: 50 }]);
    expect(flat.points.every((p) => p.y === 50)).toBe(true);
    const one = areaGeometry([7]);
    expect(one.points).toEqual([{ x: 50, y: 50 }]);
    expect(areaGeometry([])).toEqual({ ticks: [], points: [], line: "", area: "" });
  });

  test("x positions are spread evenly across the box", () => {
    const xs = areaGeometry(Array.from({ length: 12 }, (_, i) => i)).points.map((p) => p.x);
    expect(xs[0]).toBe(0);
    expect(xs[11]).toBe(100);
    expect(xs[1]).toBe(9.09);
  });
});

describe("thinLabels and withUnit", () => {
  test("at most max labels, evenly stepped from the first", () => {
    expect(thinLabels(12, 6)).toEqual([0, 2, 4, 6, 8, 10]);
    expect(thinLabels(13, 6)).toEqual([0, 3, 6, 9, 12]);
    expect(thinLabels(4, 6)).toEqual([0, 1, 2, 3]);
    expect(thinLabels(0, 6)).toEqual([]);
  });

  test("° and % sit on the number; other units get a space", () => {
    expect(withUnit("-3", "°")).toBe("-3°");
    expect(withUnit("4", "°C")).toBe("4°C");
    expect(withUnit("40", "%")).toBe("40%");
    expect(withUnit("12", "km/h")).toBe("12 km/h");
    expect(withUnit("12", "")).toBe("12");
  });
});
