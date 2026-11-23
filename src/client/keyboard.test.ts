import { describe, expect, test } from "bun:test";
import { isTypingTarget, matchShortcut, replaySlotOf, type KeyInfo } from "./keyboard";

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
    expect(matchShortcut(key("e"))).toBeNull();
  });
  test("F1..F6 play replay slots 1..6; F7 and modified F-keys do not", () => {
    for (let n = 1; n <= 6; n++) expect(matchShortcut(key("F" + n))).toEqual({ type: "replay", slot: n });
    expect(matchShortcut(key("F7"))).toBeNull();
    expect(matchShortcut(key("F12"))).toBeNull();
    for (const mod of ["ctrlKey", "metaKey", "altKey", "shiftKey"] as const) {
      expect(matchShortcut(key("F1", { [mod]: true }))).toBeNull();
    }
  });
  test("a held F-key does not restart the replay", () => {
    expect(matchShortcut(key("F2", { repeat: true }))).toBeNull();
  });
  test("Shift+R saves and Shift+E exports, with or without caps lock, once per press", () => {
    expect(matchShortcut(key("R", { shiftKey: true }))).toEqual({ type: "save" });
    expect(matchShortcut(key("r", { shiftKey: true }))).toEqual({ type: "save" });
    expect(matchShortcut(key("E", { shiftKey: true }))).toEqual({ type: "export" });
    expect(matchShortcut(key("e", { shiftKey: true }))).toEqual({ type: "export" });
    expect(matchShortcut(key("R", { shiftKey: true, repeat: true }))).toBeNull();
    expect(matchShortcut(key("R", { shiftKey: true, ctrlKey: true }))).toBeNull();
    expect(matchShortcut(key("R", { shiftKey: true, metaKey: true }))).toBeNull();
    expect(matchShortcut(key("D", { shiftKey: true }))).toBeNull();
  });
});

describe("replaySlotOf", () => {
  // The capture-phase handler prevents the browser's default (F5 reload, F1 help, F3 find) for these, held or not.
  test("names the slot for F1..F6 with no modifier, whatever else", () => {
    expect(replaySlotOf(key("F1"))).toBe(1);
    expect(replaySlotOf(key("F5", { repeat: true }))).toBe(5);
    expect(replaySlotOf(key("F6"))).toBe(6);
    expect(replaySlotOf(key("F7"))).toBeNull();
    expect(replaySlotOf(key("F10"))).toBeNull();
    expect(replaySlotOf(key("1"))).toBeNull();
    expect(replaySlotOf(key("F5", { ctrlKey: true }))).toBeNull();
    expect(replaySlotOf(key("F5", { shiftKey: true }))).toBeNull();
  });
});

describe("isTypingTarget", () => {
  // Plain stand-ins with the DOM properties the predicate reads (bun test has no DOM).
  const el = (tagName: string, props: Record<string, unknown> = {}) =>
    ({ tagName, isContentEditable: false, readOnly: false, disabled: false, ...props }) as unknown as Element;

  test("editable text entry swallows shortcuts and Space", () => {
    expect(isTypingTarget(el("INPUT", { type: "text" }))).toBe(true);
    expect(isTypingTarget(el("TEXTAREA"))).toBe(true);
    expect(isTypingTarget(el("DIV", { isContentEditable: true }))).toBe(true);
    for (const type of ["search", "email", "url", "tel", "password", "number", "date", "time", "datetime-local"]) {
      expect(isTypingTarget(el("INPUT", { type }))).toBe(true);
    }
  });
  test("a Slider thumb, read-only field, button or checkbox does not", () => {
    expect(isTypingTarget(el("INPUT", { type: "range" }))).toBe(false);
    expect(isTypingTarget(el("INPUT", { type: "text", readOnly: true }))).toBe(false);
    expect(isTypingTarget(el("INPUT", { type: "text", disabled: true }))).toBe(false);
    expect(isTypingTarget(el("TEXTAREA", { readOnly: true }))).toBe(false);
    expect(isTypingTarget(el("BUTTON"))).toBe(false);
    expect(isTypingTarget(el("INPUT", { type: "checkbox" }))).toBe(false);
    expect(isTypingTarget(el("INPUT", { type: "radio" }))).toBe(false);
    expect(isTypingTarget(el("INPUT", { type: "button" }))).toBe(false);
    expect(isTypingTarget(el("SELECT"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});
