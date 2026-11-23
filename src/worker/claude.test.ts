import { describe, expect, test } from "bun:test";
import { anthropicLlm, composerRefusalFallbackFor, SERVER_FALLBACK_BETA, toUsage, composerThinkingFor, thinkingParams, checkEnvelope, classifyLine, describeLlmError, FenceStripper, LineSplitter, MissingKeyError, repairBrackets } from "./claude";
import Anthropic from "@anthropic-ai/sdk";

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
    for (const l of [extra, missing]) {
      const c = classifyLine(l);
      expect(c.kind).toBe("a2ui");
      expect(c.kind === "a2ui" && c.repaired).toBe(true);
      expect(c.kind === "a2ui" && c.msg).toEqual(good.a2ui as never);
    }
    // A clean line is not marked repaired.
    expect(classifyLine(text)).toEqual({ kind: "a2ui", msg: good.a2ui as never });
    // With repair off (the cut-off last line after max_tokens) a miscount stays invalid.
    expect(classifyLine(extra, { repair: false }).kind).toBe("invalid");
  });

  test("truncated lines are never repaired into partial messages", () => {
    const cuts = [
      // cut right after the first component
      '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Card","child":"main"}',
      // cut after a property
      '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s1","components":[{"id":"root","component":"Card"',
      // cut inside a string
      '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s1","components":[{"id":"ro',
      // cut after an opening bracket
      '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s1","components":[',
      // a mismatch in the middle, not in the final run
      '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s1"],"components":[]}}}',
    ];
    for (const l of cuts) {
      expect(repairBrackets(l)).toBeNull();
      expect(classifyLine(l).kind).toBe("invalid");
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

describe("composer thinking per model", () => {
  test("Haiku 5.5 disables thinking; Sonnet 5.5 sends between_tools and no other field; Opus 5.5 runs adaptive at low effort", () => {
    expect(composerThinkingFor("claude-haiku-5-5")).toBe("disabled");
    expect(composerThinkingFor("claude-sonnet-5-5")).toBe("between-tools");
    expect(composerThinkingFor("claude-opus-5-5")).toBe("adaptive-low");
    expect(thinkingParams("disabled")).toEqual({ thinking: { type: "disabled" } });
    expect(thinkingParams("between-tools")).toEqual({ thinking: { type: "between_tools" } });
    expect(thinkingParams("adaptive-low")).toEqual({ thinking: { type: "adaptive" }, output_config: { effort: "low" } });
    expect(thinkingParams("default")).toEqual({});
  });
});

describe("composer refusal fallback (Sonnet 5.5)", () => {
  const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const start = { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0, cache_read_input_tokens: 5, cache_creation_input_tokens: 0 } } };
  const textBlock = (index: number, text: string) => [
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index },
  ];
  const attempt = (type: "message" | "fallback_message", model: string, input: number, output: number) => ({ type, model, input_tokens: input, output_tokens: output, cache_read_input_tokens: 5, cache_creation_input_tokens: 0, cache_creation: null });
  function fakeClient(body: string) {
    const seen: { url: string; headers: Headers; body: Record<string, unknown> }[] = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    return { seen, client: new Anthropic({ apiKey: "test", maxRetries: 0, fetch: fetch as unknown as typeof globalThis.fetch }) };
  }
  async function run(body: string) {
    const { seen, client } = fakeClient(body);
    const llm = anthropicLlm({ LLM_MODEL: "claude-sonnet-5-5" }, "between-tools", { refusalFallback: true, client });
    const stream = llm.streamText({ system: "S", user: "U" }, new AbortController().signal);
    let text = "";
    for await (const d of stream) text += d;
    return { seen, text, result: await stream.result() };
  }

  test("only claude-sonnet-5-5 opts in", () => {
    expect(composerRefusalFallbackFor("claude-sonnet-5-5")).toBe(true);
    expect(composerRefusalFallbackFor("claude-haiku-5-5")).toBe(false);
  });

  test("a mid-stream fallback keeps one text stream; the request uses the beta endpoint with fallbacks default; usage sums both attempts", async () => {
    const body = sse([
      start,
      ...textBlock(0, '{"caption":"pa'),
      { type: "content_block_start", index: 1, content_block: { type: "fallback", from: { model: "claude-sonnet-5-5" }, to: { model: "claude-sonnet-5" } } },
      { type: "content_block_stop", index: 1 },
      ...textBlock(2, 'rt"}\n'),
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 4, iterations: [attempt("message", "claude-sonnet-5-5", 10, 3), attempt("fallback_message", "claude-sonnet-5", 12, 4)] } },
      { type: "message_stop" },
    ]);
    const { seen, text, result } = await run(body);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toContain("/v1/messages");
    expect(seen[0].headers.get("anthropic-beta")).toContain(SERVER_FALLBACK_BETA);
    expect(seen[0].body).toMatchObject({ model: "claude-sonnet-5-5", fallbacks: "default", thinking: { type: "between_tools" }, stream: true });
    // The continuation joins the partial line: the line splitter sees one valid line.
    expect(text).toBe('{"caption":"part"}\n');
    expect(result.stopReason).toBe("end_turn");
    expect(result.usage).toEqual({ model: "claude-sonnet-5", input_tokens: 22, output_tokens: 7, cache_read_tokens: 10, cache_write_tokens: 0 });
  });

  test("a whole-chain refusal still ends as stop_reason refusal", async () => {
    const body = sse([start, { type: "message_delta", delta: { stop_reason: "refusal", stop_sequence: null }, usage: { output_tokens: 0 } }, { type: "message_stop" }]);
    const { text, result } = await run(body);
    expect(text).toBe("");
    expect(result.stopReason).toBe("refusal");
    expect(result.usage.model).toBe("claude-sonnet-5-5");
  });

  test("toUsage reports a plain answer as is", () => {
    const msg = { model: "claude-haiku-5-5", content: [{ type: "text" }], usage: { input_tokens: 3, output_tokens: 2, cache_read_input_tokens: 1, cache_creation_input_tokens: null } };
    expect(toUsage(msg)).toEqual({ model: "claude-haiku-5-5", input_tokens: 3, output_tokens: 2, cache_read_tokens: 1, cache_write_tokens: 0 });
  });
});

describe("thinking 400 retry", () => {
  const sse = (events: object[]) => events.map((e) => `event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`).join("");
  const errBody = (message: string) => JSON.stringify({ type: "error", error: { type: "invalid_request_error", message } });
  const okBody = sse([
    { type: "message_start", message: { id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "ok" } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: "message_stop" },
  ]);
  async function go(first: string) {
    let calls = 0;
    const fetch = async () => {
      calls++;
      if (calls === 1) return new Response(first, { status: 400, headers: { "content-type": "application/json" } });
      return new Response(okBody, { status: 200, headers: { "content-type": "text/event-stream" } });
    };
    const client = new Anthropic({ apiKey: "t", maxRetries: 0, fetch: fetch as unknown as typeof globalThis.fetch });
    const stream = anthropicLlm({ LLM_MODEL: "claude-sonnet-5-5" }, "disabled", { client }).streamText({ system: "S", user: "U" }, new AbortController().signal);
    let text = "";
    let error: unknown = null;
    try {
      for await (const d of stream) text += d;
    } catch (e) {
      error = e;
    }
    return { calls: () => calls, text, error };
  }

  test("a 400 about thinking retries once", async () => {
    const r = await go(errBody("thinking: disabled is not supported for this model"));
    expect(r.calls()).toBe(2);
    expect(r.text).toBe("ok");
    expect(r.error).toBeNull();
  });
  test("a usage-limit 400 fails once without a retry", async () => {
    const r = await go(errBody("You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC."));
    expect(r.calls()).toBe(1);
    expect(r.error).toBeInstanceOf(Anthropic.BadRequestError);
  });
  test("any other 400 fails once without a retry", async () => {
    const r = await go(errBody("messages: field required"));
    expect(r.calls()).toBe(1);
    expect(r.error).toBeInstanceOf(Anthropic.BadRequestError);
  });
});

describe("describeLlmError messages", () => {
  const apiErr = (status: number, message: string) =>
    Anthropic.APIError.generate(status, { type: "error", error: { type: "x", message } }, `${status} raw`, new Headers());
  test("usage limit with a date", () => {
    const e = apiErr(400, "You have reached your specified API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.");
    expect(describeLlmError(e)).toBe("Claude API: usage limit reached — access returns 2026-12-01 00:00 UTC");
  });
  test("usage limit without a date invents none", () => {
    expect(describeLlmError(apiErr(400, "API usage limit reached"))).toBe("Claude API: usage limit reached");
  });
  test("auth, 429, 529", () => {
    expect(describeLlmError(apiErr(401, "invalid x-api-key"))).toContain("authentication failed");
    expect(describeLlmError(apiErr(429, "slow down"))).toContain("rate limited");
    expect(describeLlmError(apiErr(529, "Overloaded"))).toContain("overloaded");
  });
  test("generic 400 shows the message, not JSON, capped", () => {
    expect(describeLlmError(apiErr(400, "messages: field required"))).toBe("Claude API: bad request (messages: field required)");
    const long = describeLlmError(apiErr(400, "x".repeat(400)));
    expect(long).not.toContain("{");
    expect(long.length).toBeLessThan(200);
  });
  test("network error", () => {
    expect(describeLlmError(new Anthropic.APIConnectionError({ message: "fetch failed" }))).toBe("Claude API: connection failed");
  });
});

describe("describeLlmError", () => {
  test("missing key and unknown errors", () => {
    expect(describeLlmError(new MissingKeyError("x"))).toBe("Claude API: ANTHROPIC_API_KEY is not set");
    expect(describeLlmError(new Error("boom"))).toBe("Composer failed: boom");
  });
});
