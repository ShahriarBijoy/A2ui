import { describe, expect, test } from "bun:test";
import { parseNumberDraft } from "./numberDraft";

describe("number TextField drafts", () => {
  test("complete numbers are written as numbers", () => {
    expect(parseNumberDraft("12.50")).toEqual({ kind: "number", value: 12.5 });
    expect(parseNumberDraft("1.05")).toEqual({ kind: "number", value: 1.05 });
    expect(parseNumberDraft("1.0")).toEqual({ kind: "number", value: 1 });
    expect(parseNumberDraft("-3")).toEqual({ kind: "number", value: -3 });
    expect(parseNumberDraft(".5")).toEqual({ kind: "number", value: 0.5 });
    expect(parseNumberDraft(" 7 ")).toEqual({ kind: "number", value: 7 });
    expect(parseNumberDraft("12,5")).toEqual({ kind: "number", value: 12.5 });
  });
  test("a trailing dot is still a number, so the store follows while the draft keeps the dot", () => {
    expect(parseNumberDraft("12.")).toEqual({ kind: "number", value: 12 });
  });
  test("partial input keeps the draft and writes nothing", () => {
    for (const s of ["-", ".", "-.", "1e", "1e5", "0x10", "abc", "1.2.3", "--1"]) {
      expect(parseNumberDraft(s)).toEqual({ kind: "partial" });
    }
  });
  test("an empty field writes the empty string", () => {
    expect(parseNumberDraft("")).toEqual({ kind: "empty" });
    expect(parseNumberDraft("   ")).toEqual({ kind: "empty" });
  });
  test("typing 12.50 key by key never loses a character and ends at 12.5", () => {
    const written: number[] = [];
    let draft = "";
    for (const ch of "12.50") {
      draft += ch;
      const p = parseNumberDraft(draft);
      if (p.kind === "number") written.push(p.value);
    }
    expect(draft).toBe("12.50");
    expect(written).toEqual([1, 12, 12, 12.5, 12.5]);
  });
});
