import { describe, expect, test } from "bun:test";
import type { Action, JsonValue } from "@shared/a2ui";
import { EvalError, evalChecks, formatDate, resolve, resolveActionContext, resolveBoolean, resolveNumber, resolveString, resolveStringList, type EvalContext } from "./evaluate";

const data: JsonValue = {
  booking: { place: "Placeholder Bistro", time: ["19:00"], guests: 4, note: "" },
  flight: { price_eur: 312, cents: 312.5 },
  places: [
    { id: "p1", name: "One", walk_min: 4 },
    { id: "p2", name: "Two", walk_min: 7 },
  ],
};
const top: EvalContext = { data, scope: "/" };
const item: EvalContext = { data, scope: "/places/1" };
const call = (fn: string, args: Record<string, JsonValue | { "@path": string }>) => ({ "@call": fn, args });

describe("resolve", () => {
  test("literals, arrays and objects resolve recursively", () => {
    expect(resolve("x", top)).toBe("x");
    expect(resolve(3, top)).toBe(3);
    expect(resolve(null, top)).toBeNull();
    expect(resolve(undefined, top)).toBeUndefined();
    expect(resolve([{ "@path": "/booking/guests" }, "a"], top)).toEqual([4, "a"]);
    expect(resolve({ g: { "@path": "/booking/guests" } }, top)).toEqual({ g: 4 });
  });
  test("absolute and relative @path inside a template scope", () => {
    expect(resolve({ "@path": "/booking/place" }, top)).toBe("Placeholder Bistro");
    expect(resolve({ "@path": "name" }, item)).toBe("Two");
    expect(resolve({ "@path": "/booking/guests" }, item)).toBe(4);
    expect(resolve({ "@path": "missing" }, item)).toBeUndefined();
  });
  test("unknown function throws EvalError", () => {
    expect(() => resolve({ "@call": "eval", args: {} }, top)).toThrow(EvalError);
  });
  test("typed helpers coerce and never throw on type mismatch", () => {
    expect(resolveString({ "@path": "/booking/guests" }, top)).toBe("4");
    expect(resolveString({ "@path": "/nope" }, top, "fallback")).toBe("fallback");
    expect(resolveNumber("12", top)).toBe(12);
    expect(resolveNumber("twelve", top, 7)).toBe(7);
    expect(resolveBoolean({ "@path": "/nope" }, top, true)).toBe(true);
    expect(resolveBoolean("false", top)).toBe(false);
    expect(resolveStringList({ "@path": "/booking/time" }, top)).toEqual(["19:00"]);
    expect(resolveStringList("19:00", top)).toEqual(["19:00"]);
    expect(resolveStringList({ "@path": "/booking/guests" }, top)).toEqual(["4"]);
    expect(resolveStringList({ "@path": "/nope" }, top)).toEqual([]);
  });
});

describe("functions", () => {
  test("formatString interpolates absolute and relative paths; missing → empty", () => {
    const D = "$";
    expect(resolve(call("formatString", { value: "## Table at " + D + "{/booking/place}" }), top)).toBe("## Table at Placeholder Bistro");
    expect(resolve(call("formatString", { value: D + "{name} · " + D + "{walk_min} min" }), item)).toBe("Two · 7 min");
    expect(resolve(call("formatString", { value: "[" + D + "{/nope}]" }), top)).toBe("[]");
  });
  test("formatCurrency", () => {
    expect(resolve(call("formatCurrency", { value: { "@path": "/flight/price_eur" }, currency: "EUR" }), top)).toBe("€312");
    expect(resolve(call("formatCurrency", { value: { "@path": "/flight/cents" } }), top)).toBe("€312.50");
    expect(resolve(call("formatCurrency", { value: 20, currency: "USD" }), top)).toBe("$20");
    expect(resolve(call("formatCurrency", { value: "n/a" }), top)).toBe("");
  });
  test("formatNumber", () => {
    expect(resolve(call("formatNumber", { value: 1234.5 }), top)).toBe("1,234.5");
    expect(resolve(call("formatNumber", { value: 2, decimals: 2 }), top)).toBe("2.00");
    expect(resolve(call("formatNumber", { value: "x" }), top)).toBe("");
  });
  test("formatDate tokens on dates, times and date-times", () => {
    expect(formatDate("2026-11-28", "EEE d MMM")).toBe("Sat 28 Nov");
    expect(formatDate("2026-11-28", "EEEE, MMMM dd yyyy")).toBe("Saturday, November 28 2026");
    expect(formatDate("2026-03-05", "d.M.YYYY / dd.MM")).toBe("5.3.2026 / 05.03");
    expect(formatDate("19:05", "HH:mm")).toBe("19:05");
    expect(formatDate("07:30", "h:mm a")).toBe("7:30 AM");
    expect(formatDate("2026-11-28T00:15", "H:mm h a")).toBe("0:15 12 AM");
    expect(formatDate("2026-11-28T19:30", "EEE HH:mm")).toBe("Sat 19:30");
    expect(resolve(call("formatDate", { value: "2026-11-28", format: "EEE" }), top)).toBe("Sat");
  });
  test("formatDate: words and quoted text pass through, bad input is returned as is", () => {
    expect(formatDate("2026-11-28T19:30", "EEE d MMM at HH:mm")).toBe("Sat 28 Nov at 19:30");
    expect(formatDate("2026-11-28", "'day' d")).toBe("day 28");
    expect(formatDate("2026-02-30", "d MMM")).toBe("2026-02-30");
    expect(formatDate("soon", "d MMM")).toBe("soon");
    expect(formatDate("2026-11-28")).toBe("Sat 28 Nov");
    expect(formatDate("19:00", "d MMM")).toBe(" ");
  });
  test("required", () => {
    expect(resolve(call("required", { value: { "@path": "/booking/time" } }), top)).toBe(true);
    expect(resolve(call("required", { value: { "@path": "/booking/note" } }), top)).toBe(false);
    expect(resolve(call("required", { value: [] }), top)).toBe(false);
    expect(resolve(call("required", { value: { "@path": "/nope" } }), top)).toBe(false);
    expect(resolve(call("required", { value: 0 }), top)).toBe(true);
  });
  test("numeric", () => {
    expect(resolve(call("numeric", { value: { "@path": "/booking/guests" }, min: 1, max: 12 }), top)).toBe(true);
    expect(resolve(call("numeric", { value: 13, min: 1, max: 12 }), top)).toBe(false);
    expect(resolve(call("numeric", { value: "5" }), top)).toBe(true);
    expect(resolve(call("numeric", { value: "five" }), top)).toBe(false);
    expect(resolve(call("numeric", { value: "" }), top)).toBe(false);
  });
  test("and, or, not", () => {
    expect(resolve({ "@call": "and", args: { values: [true, { "@path": "/booking/guests" }] } }, top)).toBe(true);
    expect(resolve({ "@call": "and", args: { values: [true, false] } }, top)).toBe(false);
    expect(resolve({ "@call": "or", args: { values: [false, { "@path": "/booking/place" }] } }, top)).toBe(true);
    expect(resolve({ "@call": "or", args: { values: [false, ""] } }, top)).toBe(false);
    expect(resolve({ "@call": "not", args: { value: { "@call": "required", args: { value: "" } } } }, top)).toBe(true);
  });
});

describe("checks", () => {
  const required = (path: string) => ({ "@call": "required", args: { value: { "@path": path } } });
  test("all pass", () => {
    expect(evalChecks([{ condition: required("/booking/time"), message: "Pick a time" }], top)).toEqual({ ok: true });
    expect(evalChecks(undefined, top)).toEqual({ ok: true });
  });
  test("first failing check's message", () => {
    const res = evalChecks(
      [
        { condition: required("/booking/time"), message: "Pick a time" },
        { condition: required("/booking/note"), message: "Add a note" },
        { condition: false, message: "never reached" },
      ],
      top,
    );
    expect(res).toEqual({ ok: false, message: "Add a note" });
  });
  test("a check that cannot be evaluated fails", () => {
    expect(evalChecks([{ condition: { "@call": "eval" }, message: "nope" }], top)).toEqual({ ok: false, message: "nope" });
  });
});

describe("action context", () => {
  test("resolves bindings in the template scope", () => {
    const action: Action = {
      event: {
        name: "pick_place",
        context: { id: { "@path": "id" }, name: { "@path": "name" }, guests: { "@path": "/booking/guests" }, fixed: "x", gone: { "@path": "nope" } },
      },
    };
    expect(resolveActionContext(action, item)).toEqual({ id: "p2", name: "Two", guests: 4, fixed: "x", gone: null });
    expect(resolveActionContext({ event: { name: "go" } }, top)).toEqual({});
  });
});
