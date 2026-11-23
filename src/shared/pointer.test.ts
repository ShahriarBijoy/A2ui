import { describe, expect, test } from "bun:test";
import type { JsonValue } from "./a2ui";
import { formatPointer, getAt, parsePointer, pathsOverlap, removeAt, resolvePath, setAt } from "./pointer";

const data: JsonValue = {
  trip: { guests: 4, "a/b": 1, "m~n": 2 },
  places: [{ id: "p1", name: "One" }, { id: "p2", name: "Two" }],
};

describe("pointer get", () => {
  test("reads nested objects and arrays", () => {
    expect(getAt(data, "/trip/guests")).toBe(4);
    expect(getAt(data, "/places/1/name")).toBe("Two");
    expect(getAt(data, "/")).toEqual(data);
  });
  test("missing paths are undefined, never throw", () => {
    expect(getAt(data, "/trip/nope")).toBeUndefined();
    expect(getAt(data, "/places/9/name")).toBeUndefined();
    expect(getAt(data, "/places/x")).toBeUndefined();
    expect(getAt(data, "/trip/guests/deeper")).toBeUndefined();
  });
  test("~1 and ~0 escapes", () => {
    expect(getAt(data, "/trip/a~1b")).toBe(1);
    expect(getAt(data, "/trip/m~0n")).toBe(2);
    expect(parsePointer("/a~1b/m~0n")).toEqual(["a/b", "m~n"]);
    expect(formatPointer(["a/b", "m~n"])).toBe("/a~1b/m~0n");
  });
});

describe("pointer set", () => {
  test("is immutable and creates containers on the way", () => {
    const next = setAt(data, "/trip/guests", 6);
    expect(getAt(next, "/trip/guests")).toBe(6);
    expect(getAt(data, "/trip/guests")).toBe(4);
    expect(getAt(setAt({}, "/a/b/c", "x"), "/a/b/c")).toBe("x");
  });
  test("writes into arrays and appends with -", () => {
    const next = setAt(data, "/places/0/name", "Uno");
    expect(getAt(next, "/places/0/name")).toBe("Uno");
    const appended = setAt(data, "/places/-", { id: "p3" });
    expect(getAt(appended, "/places/2/id")).toBe("p3");
  });
  test("escaped keys", () => {
    expect(getAt(setAt({}, "/a~1b", 5), "/a~1b")).toBe(5);
  });
  test("root replaces the whole model", () => {
    expect(setAt(data, "/", { fresh: true })).toEqual({ fresh: true });
  });
});

describe("pointer delete", () => {
  test("null deletes (A2UI)", () => {
    const next = setAt(data, "/trip/guests", null);
    expect(getAt(next, "/trip/guests")).toBeUndefined();
    expect(next).not.toHaveProperty("trip.guests");
    expect(getAt(data, "/trip/guests")).toBe(4);
  });
  test("removeAt splices arrays and ignores missing paths", () => {
    const next = removeAt(data, "/places/0");
    expect(getAt(next, "/places/0/id")).toBe("p2");
    expect(removeAt(data, "/trip/nope")).toEqual(data);
  });
});

describe("relative paths", () => {
  test("resolve against the template scope", () => {
    expect(resolvePath("name", "/places/1")).toBe("/places/1/name");
    expect(resolvePath("/trip/guests", "/places/1")).toBe("/trip/guests");
    expect(resolvePath("name", "/")).toBe("/name");
    expect(resolvePath(".", "/places/1")).toBe("/places/1");
    expect(getAt(data, resolvePath("name", "/places/0"))).toBe("One");
  });
  test("pathsOverlap is token-wise", () => {
    expect(pathsOverlap("/booking", "/booking/guests")).toBe(true);
    expect(pathsOverlap("/booking/guests", "/booking/guests")).toBe(true);
    expect(pathsOverlap("/booking/guest", "/booking/guests")).toBe(false);
    expect(pathsOverlap("/", "/anything")).toBe(true);
  });
});
