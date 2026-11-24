import { describe, expect, test } from "bun:test";
import { BRICKS } from "@shared/catalog";
import { BRICK_GLYPHS, NEW_BRICK_NAMES } from "./glyphs";

describe("brick glyphs", () => {
  test("every catalog brick has a glyph", () => {
    expect(BRICKS.filter((b) => !(b.name in BRICK_GLYPHS)).map((b) => b.name)).toEqual([]);
  });
  test("the ten new names have glyphs", () => {
    expect(NEW_BRICK_NAMES.size).toBe(10);
    for (const name of NEW_BRICK_NAMES) expect(BRICK_GLYPHS[name]).toBeDefined();
  });
});
