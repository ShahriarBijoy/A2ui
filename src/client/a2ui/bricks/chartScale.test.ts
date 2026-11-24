import { describe, expect, test } from "bun:test";
import { niceScale, scalePct } from "./chartScale";

describe("niceScale", () => {
  test("a round top just above the largest value, four even steps", () => {
    expect(niceScale([87, 40, 12])).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
    expect(niceScale([605, 476])).toEqual({ max: 800, ticks: [0, 200, 400, 600, 800] });
    expect(niceScale([3])).toEqual({ max: 4, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale([100])).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
    expect(niceScale([0.3, 0.1])).toEqual({ max: 0.4, ticks: [0, 0.1, 0.2, 0.3, 0.4] });
  });

  test("negatives and non-numbers count as zero; nothing positive gives a flat axis", () => {
    expect(niceScale([-5, Number.NaN, 8])).toEqual({ max: 8, ticks: [0, 2, 4, 6, 8] });
    expect(niceScale([0, -1])).toEqual({ max: 0, ticks: [0] });
    expect(niceScale([])).toEqual({ max: 0, ticks: [0] });
  });

  test("fewer intervals for a smaller axis", () => {
    expect(niceScale([87], 2)).toEqual({ max: 100, ticks: [0, 50, 100] });
  });
});

describe("scalePct", () => {
  test("percent of the top, clamped", () => {
    const s = niceScale([87]);
    expect(scalePct(50, s)).toBe(50);
    expect(scalePct(-3, s)).toBe(0);
    expect(scalePct(500, s)).toBe(100);
    expect(scalePct(5, { max: 0, ticks: [0] })).toBe(0);
  });
});
