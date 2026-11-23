import { describe, expect, test } from "bun:test";
import { checkEnvelope, classifyLine, describeLlmError, FenceStripper, LineSplitter, MissingKeyError } from "./claude";

describe("LineSplitter", () => {
  test("joins lines split across chunks", () => {
    const s = new LineSplitter();
    expect(s.push('{"a":')).toEqual([]);
    expect(s.push('1}\n{"b"')).toEqual(['{"a":1}']);
    expect(s.push(":2}\n")).toEqual(['{"b":2}']);
    expect(s.flush()).toEqual([]);
  });

  test("many lines in one chunk, blank lines kept for the classifier", () => {
    const s = new LineSplitter();
    expect(s.push("a\nb\n\nc\n")).toEqual(["a", "b", "", "c"]);
  });

  test("CRLF", () => {
    const s = new LineSplitter();
    expect(s.push("a\r\nb\r")).toEqual(["a"]);
    expect(s.push("\nc")).toEqual(["b"]);
    expect(s.flush()).toEqual(["c"]);
  });

  test("trailing partial line is flushed at the end; whitespace-only is dropped", () => {
    const s = new LineSplitter();
    s.push('{"caption":"x"}');
    expect(s.flush()).toEqual(['{"caption":"x"}']);
    s.push("   ");
    expect(s.flush()).toEqual([]);
  });

  test("character-by-character stream gives the same lines", () => {
    const text = '{"a":1}\r\n\n{"b":[1,2]}\n{"c":"x\\ny"}';
    const s = new LineSplitter();
    const out: string[] = [];
    for (const ch of text) out.push(...s.push(ch));
    out.push(...s.flush());
    expect(out).toEqual(['{"a":1}', "", '{"b":[1,2]}', '{"c":"x\\ny"}']);
  });
});

describe("classifyLine", () => {
  const create = { version: "1.0", createSurface: { surfaceId: "s1", catalogId: "x/catalog/brick-box/v1" } };

  test("a2ui line", () => {
    expect(classifyLine(JSON.stringify({ a2ui: create }))).toEqual({ kind: "a2ui", msg: create as never });
  });

  test("bare A2UI message without wrapper is accepted", () => {
    expect(classifyLine(JSON.stringify(create)).kind).toBe("a2ui");
  });

  test("data line", () => {
    expect(classifyLine('{"data":{"source":"places","args":{"kind":"vegan"},"into":"/places"}}')).toEqual({
      kind: "data",
      source: "places",
      args: { kind: "vegan" },
      into: "/places",
    });
    expect(classifyLine('{"data":{"source":"places","into":"/p"}}')).toEqual({ kind: "data", source: "places", args: {}, into: "/p" });
  });

  test("caption line", () => {
    expect(classifyLine('{"caption":"  Places nearby "}')).toEqual({ kind: "caption", text: "Places nearby" });
  });

  test("blank and fence lines are ignored (not counted)", () => {
    for (const l of ["", "   ", "```", "```json", " ```jsonl "]) expect(classifyLine(l)).toEqual({ kind: "ignore" });
  });

  test("a fence glued to an object is stripped", () => {
    expect(classifyLine('```json {"caption":"x"}').kind).toBe("caption");
    expect(classifyLine('{"caption":"x"}```').kind).toBe("caption");
  });

  test("invalid lines", () => {
    const bad = [
      "Here is your UI:",
      '{"a2ui":',
      "[1,2]",
      '{"a2ui":{"version":"0.9","createSurface":{"surfaceId":"s1"}}}',
      '{"a2ui":{"version":"1.0","createSurface":{"surfaceId":"s1"},"updateComponents":{"surfaceId":"s1"}}}',
      '{"a2ui":{"version":"1.0","renderHtml":{"surfaceId":"s1"}}}',
      '{"a2ui":{"version":"1.0","createSurface":{}}}',
      '{"data":{"source":"places","into":"places"}}',
      '{"data":{"source":"places","into":"/"}}',
      '{"data":{"into":"/p"}}',
      '{"caption":42}',
      '{"hello":"world"}',
    ];
    for (const l of bad) expect(classifyLine(l).kind).toBe("invalid");
  });

  test("miscounted closing brackets at the end of a line are repaired", () => {
    const good = {
      a2ui: {
        version: "1.0",
        updateComponents: {
          surfaceId: "s2",
          components: [{ id: "f", component: "OptionCard", title: "x}", action: { event: { name: "pick", context: { id: { "@path": "id" } } } } }],
        },
      },
    };
    const text = JSON.stringify(good);
    const extra = text.replace('"id"}}}}}]', '"id"}}}}}}]');
    const missing = text.replace('"id"}}}}}]}}}', '"id"}}}}}}}');
    expect(extra).not.toBe(text);
    expect(missing).not.toBe(text);
    for (const l of [extra, missing, text.slice(0, -2)]) {
      const c = classifyLine(l);
      expect(c.kind).toBe("a2ui");
      expect(c.kind === "a2ui" && c.msg).toEqual(good.a2ui as never);
    }
  });

  test("checkEnvelope accepts each known key", () => {
    for (const key of ["createSurface", "updateComponents", "updateDataModel", "deleteSurface"]) {
      expect(checkEnvelope({ version: "1.0", [key]: { surfaceId: "s" } })).not.toBeNull();
    }
  });
});

describe("FenceStripper", () => {
  const run = (chunks: string[]) => {
    const f = new FenceStripper();
    return chunks.map((c) => f.push(c)).join("") + f.end();
  };

  test("plain HTML passes through unchanged", () => {
    const html = "<!doctype html>\n<html><body>\n<p>Hi `code`</p>\n</body></html>";
    expect(run([html])).toBe(html);
    expect(run(html.split(""))).toBe(html);
  });

  test("leading ```html and trailing ``` are dropped, even when split across deltas", () => {
    expect(run(["```html\n<div>a</div>\n```"])).toBe("<div>a</div>\n");
    expect(run(["`", "`", "`ht", "ml\n<di", "v>a</div>\n`", "``\n"])).toBe("<div>a</div>\n");
  });

  test("forwards content before the line ends (minified HTML still streams)", () => {
    const f = new FenceStripper();
    expect(f.push("<html><body>")).toBe("<html><body>");
    expect(f.push("<p>")).toBe("<p>");
  });

  test("backticks that are not a fence are kept", () => {
    expect(run(["```x y\n"])).toBe("```x y\n");
  });
});

describe("describeLlmError", () => {
  test("missing key and unknown errors", () => {
    expect(describeLlmError(new MissingKeyError("x"))).toBe("Claude API: ANTHROPIC_API_KEY is not set");
    expect(describeLlmError(new Error("boom"))).toBe("Composer failed: boom");
  });
});
