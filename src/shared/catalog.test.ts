import { describe, expect, test } from "bun:test";
import { BRICKS, BRICK_NAMES, brickDef, catalogPromptBlock, INPUT_BRICKS } from "./catalog";

describe("catalog", () => {
  test("catalog has 27 unique bricks with purpose, props and predictHint", () => {
    expect(BRICKS).toHaveLength(27);
    expect(new Set(BRICK_NAMES).size).toBe(27);
    for (const b of BRICKS) {
      expect(b.poolLabel.trim()).not.toBe("");
      expect(b.purpose.trim()).not.toBe("");
      expect(b.props.trim()).not.toBe("");
      expect(b.predictHint.trim()).not.toBe("");
      expect(catalogPromptBlock()).toContain(`  ${b.name}: ${b.props}. ${b.purpose}`);
    }
  });

  test("the ten new bricks sit in their groups; none is an input", () => {
    const where = (name: Parameters<typeof brickDef>[0]) => [brickDef(name).group, brickDef(name).custom];
    expect(where("Icon")).toEqual(["content", false]);
    expect(where("Image")).toEqual(["content", false]);
    expect(where("Table")).toEqual(["layout", true]);
    expect(where("Accordion")).toEqual(["layout", true]);
    for (const name of ["Chart", "Timeline", "Badge", "Alert", "Progress", "Rating"] as const) expect(where(name)).toEqual(["content", true]);
    for (const name of ["Icon", "Image", "Table", "Accordion", "Chart", "Timeline", "Badge", "Alert", "Progress", "Rating"] as const) {
      expect(INPUT_BRICKS.has(name)).toBe(false);
    }
  });

  test("OptionCard and Button list the optional icon prop", () => {
    expect(brickDef("OptionCard").props).toContain("icon?");
    expect(brickDef("Button").props).toContain("icon?");
  });
});
