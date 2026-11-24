import { describe, expect, test } from "bun:test";
import { ICON_NAMES, isIconName } from "@shared/icons";
import { ICONS } from "./iconMap";

describe("icon set", () => {
  test("every name maps to a component", () => {
    for (const n of ICON_NAMES) expect(typeof ICONS[n]).toMatch(/function|object/);
  });
  test("isIconName accepts listed names only", () => {
    expect(isIconName("plane")).toBe(true);
    expect(isIconName("Plane")).toBe(false);
    expect(isIconName("rocket")).toBe(false);
    expect(isIconName(3)).toBe(false);
  });
});
