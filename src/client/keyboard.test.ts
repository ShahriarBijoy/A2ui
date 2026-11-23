import { describe, expect, test } from "bun:test";
import { isTextEntry, matchShortcut, type KeyInfo } from "./keyboard";

const key = (k: string, extra: Partial<KeyInfo> = {}): KeyInfo => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  ...extra,
});

describe("matchShortcut", () => {
  test("1/2/3 follow the visual order Widgets | HTML | A2UI", () => {
    expect(matchShortcut(key("1"))).toEqual({ type: "mode", mode: "widgets" });
    expect(matchShortcut(key("2"))).toEqual({ type: "mode", mode: "html" });
    expect(matchShortcut(key("3"))).toEqual({ type: "mode", mode: "a2ui" });
  });
  test("D toggles the decision model, with or without caps lock", () => {
    expect(matchShortcut(key("d"))).toEqual({ type: "decision" });
    expect(matchShortcut(key("D"))).toEqual({ type: "decision" });
  });
  test("Esc clears", () => {
    expect(matchShortcut(key("Escape"))).toEqual({ type: "clear" });
  });
  test("modifiers disable every shortcut", () => {
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(matchShortcut(key("1", { [mod]: true }))).toBeNull();
      expect(matchShortcut(key("d", { [mod]: true }))).toBeNull();
      expect(matchShortcut(key("Escape", { [mod]: true }))).toBeNull();
    }
  });
  test("key repeat does not re-fire mode or decision", () => {
    expect(matchShortcut(key("d", { repeat: true }))).toBeNull();
    expect(matchShortcut(key("2", { repeat: true }))).toBeNull();
  });
  test("Space and other keys are not shortcuts", () => {
    expect(matchShortcut(key(" "))).toBeNull();
    expect(matchShortcut(key("4"))).toBeNull();
    expect(matchShortcut(key("r"))).toBeNull();
  });
});

describe("isTextEntry", () => {
  const el = (match: boolean) => ({ closest: () => (match ? {} : null) });
  test("elements inside inputs, textareas, selects and contenteditable count", () => {
    expect(isTextEntry(el(true) as unknown as EventTarget)).toBe(true);
  });
  test("other targets do not", () => {
    expect(isTextEntry(el(false) as unknown as EventTarget)).toBe(false);
    expect(isTextEntry(null)).toBe(false);
    expect(isTextEntry({} as EventTarget)).toBe(false);
  });
});
