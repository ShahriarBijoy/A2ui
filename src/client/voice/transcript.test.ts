import { describe, expect, test } from "bun:test";
import { TranscriptAssembler } from "./transcript";

const f = (text: string) => ({ text, is_final: true });
const n = (text: string) => ({ text, is_final: false });

describe("TranscriptAssembler", () => {
  test("appends finals and replaces the interim tail across results", () => {
    const a = new TranscriptAssembler();
    expect(a.feed([n("Book"), n(" a")])).toEqual({ final: "", interim: "Book a" });
    expect(a.feed([f("Book"), n(" a"), n(" fli")])).toEqual({ final: "Book", interim: " a fli" });
    expect(a.feed([f(" a"), f(" flight"), n(" to")])).toEqual({ final: "Book a flight", interim: " to" });
    expect(a.feed([f(" to"), f(" Bremen")])).toEqual({ final: "Book a flight to Bremen", interim: "" });
  });

  test("an empty result clears the interim tail but keeps finals", () => {
    const a = new TranscriptAssembler();
    a.feed([f("Hello"), n(" wor")]);
    expect(a.feed([])).toEqual({ final: "Hello", interim: "" });
  });

  test("control tokens are stripped", () => {
    const a = new TranscriptAssembler();
    a.feed([f("Hi"), f("<end>"), f("<fin>")]);
    expect(a.finalText()).toBe("Hi");
    expect(a.view()).toEqual({ final: "Hi", interim: "" });
  });

  test("angle brackets inside speech are not control tokens", () => {
    const a = new TranscriptAssembler();
    a.feed([f("a"), f(" <b> c")]);
    expect(a.finalText()).toBe("a <b> c");
  });

  test("fullText joins final and interim with normalised spaces", () => {
    const a = new TranscriptAssembler();
    a.feed([f(" I"), f(" want"), n("  a  table")]);
    expect(a.fullText()).toBe("I want a table");
  });

  test("takeFinal returns the utterance and starts a fresh one", () => {
    const a = new TranscriptAssembler();
    a.feed([f("First"), f(" one"), f("<end>")]);
    expect(a.takeFinal()).toBe("First one");
    expect(a.view()).toEqual({ final: "", interim: "" });
    a.feed([f(" Second")]);
    expect(a.takeFinal()).toBe("Second");
  });
});
