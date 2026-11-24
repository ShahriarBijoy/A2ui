import { describe, expect, test } from "bun:test";
import { barWidths, imageView, parseRating, resolveItems } from "./items";

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
