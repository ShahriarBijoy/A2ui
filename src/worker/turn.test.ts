import { describe, expect, test } from "bun:test";
import type { Knob, RouteResult, TurnEvent, TurnRequest } from "@shared/protocol";
import type { Llm, LlmUsage, Prompt, TextStream, WidgetsReply } from "./claude";
import type { SearchOutcome, SearchRequest } from "./search";
import { COMPOSER_RETRY_NOTE } from "./prompts";
import { encodeEvent, fixChecks, MAX_SEARCHES_PER_TURN, parseTurnRequest, patchCaption, runTurn, SSE_HEADERS, sseResponse, widgetEvent, type TurnDeps } from "./turn";
import { generateFlights } from "./data/flights";

/** Smallest real answer: one A2UI line and a caption. */
const MINIMAL = '{"a2ui":{"version":"1.0","updateDataModel":{"surfaceId":"s2","path":"/booking/guests","value":5}}}\n{"caption":"x"}\n';
const usage: LlmUsage = { model: "fake-model", input_tokens: 10, output_tokens: 20, cache_read_tokens: 5, cache_write_tokens: 0 };
const ctx = {
  date: "2026-11-23",
  weekday: "Monday",
  time: "19:30",
  tomorrow: "2026-11-24",
  tomorrowWeekday: "Tuesday",
  venue: "Venue",
  city: "Bremen",
  catalogId: "http://test/catalog/brick-box/v1",
};

function fakeStream(chunks: string[], opts: { failAfter?: number; hang?: boolean; stopReason?: string } = {}): TextStream {
  let aborted = false;
  return {
    async *[Symbol.asyncIterator]() {
      for (let i = 0; i < chunks.length; i++) {
        if (opts.failAfter === i) throw new Error("stream broke");
        await Promise.resolve();
        yield chunks[i];
      }
      if (opts.hang) await new Promise(() => {});
    },
    async result() {
      return { usage, stopReason: opts.stopReason ?? "end_turn" };
    },
    abort() {
      aborted = true;
      void aborted;
    },
  };
}

function fakeLlm(chunks: string[], opts: Parameters<typeof fakeStream>[1] = {}, reply?: WidgetsReply): Llm & { prompts: Prompt[] } {
  const prompts: Prompt[] = [];
  return {
    prompts,
    streamText(prompt) {
      prompts.push(prompt);
      return fakeStream(chunks, opts);
    },
    async callTools(prompt) {
      prompts.push(prompt);
      if (!reply) throw new Error("no reply");
      return reply;
    },
  };
}

function deps(over: Partial<TurnDeps> = {}): TurnDeps {
  let t = 0;
  return {
    route: async () => {
      throw new Error("route must not be called");
    },
    llm: fakeLlm([]),
    context: ctx,
    now: () => (t += 10),
    composeTimeoutMs: 1000,
    routeGuardMs: 500,
    warn: () => {},
    ...over,
  };
}

const guestsKnob: Knob = {
  type: "choice",
  id: "/booking/guests",
  componentId: "guests",
  component: "Stepper",
  path: "/booking/guests",
  label: "Guests",
  current: 4,
  currentLabel: "4",
  options: [5, 6, 7].map((n) => ({ key: String(n), label: String(n), value: n })),
};
const timeKnob: Knob = {
  type: "choice",
  id: "/booking/time",
  componentId: "time",
  component: "ChoicePicker",
  path: "/booking/time",
  label: "Time",
  current: ["19:00"],
  currentLabel: "19:00",
  options: ["19:30", "20:00"].map((t) => ({ key: t, label: t, value: [t] })),
};

function request(over: Partial<TurnRequest> = {}): TurnRequest {
  return {
    mode: "a2ui",
    decision: true,
    input: { type: "utterance", text: "We're six, and later." },
    thread: [],
    surface: { id: "s2", components: [{ id: "root", component: "Card" }], data: { booking: { guests: 4, time: ["19:00"] } }, knobs: [guestsKnob, timeKnob] },
    nextSurfaceId: "s3",
    ...over,
  };
}

async function collect(req: TurnRequest, d: TurnDeps, signal?: AbortSignal): Promise<TurnEvent[]> {
  const events: TurnEvent[] = [];
  await runTurn(req, d, (ev) => void events.push(ev), signal);
  return events;
}

const patchRoute = (ms = 180): RouteResult => ({
  kind: "edit",
  kindConfidence: 0.97,
  decision: "patch",
  patches: [
    { knobId: "/booking/guests", path: "/booking/guests", value: 6, confidence: 0.98 },
    { knobId: "/booking/time", path: "/booking/time", value: ["20:00"], confidence: 0.91 },
  ],
  ms,
  engine: "jev-1.14.0",
  reason: "edit",
});

describe("SSE encoding", () => {
  test("one data: line per event, blank line after", () => {
    const s = encodeEvent({ type: "caption", text: "line\nbreak" });
    expect(s).toBe('data: {"type":"caption","text":"line\\nbreak"}\n\n');
    expect(s.trimEnd().split("\n")).toHaveLength(1);
  });

  test("sseResponse streams events with the SSE headers and closes", async () => {
    const res = sseResponse(async (emit) => {
      emit({ type: "caption", text: "a" });
      await Promise.resolve();
      emit({ type: "done" });
    });
    for (const [k, v] of Object.entries(SSE_HEADERS)) expect(res.headers.get(k)).toBe(v);
    expect(await res.text()).toBe('data: {"type":"caption","text":"a"}\n\ndata: {"type":"done"}\n\n');
  });

  test("cancelling the body aborts the run", async () => {
    let seen: AbortSignal | null = null;
    const res = sseResponse(async (emit, signal) => {
      seen = signal;
      emit({ type: "caption", text: "a" });
      await new Promise((r) => signal.addEventListener("abort", r));
    });
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(seen!.aborted).toBe(true);
  });
});

describe("runTurn: patch path", () => {
  test("route + knob updateDataModel events + code-written caption + done, no LLM, no usage", async () => {
    const llm = fakeLlm(['{"caption":"should not run"}\n']);
    const events = await collect(request(), deps({ route: async () => patchRoute(), llm }));
    expect(events.map((e) => e.type)).toEqual(["route", "a2ui", "a2ui", "caption", "done"]);
    expect(events[0]).toEqual({ type: "route", kind: "edit", decision: "patch", ms: 180, engine: "jev-1.14.0", reason: "edit", patches: 2 });
    expect(events[1]).toEqual({
      type: "a2ui",
      origin: "knob",
      msg: { version: "1.0", updateDataModel: { surfaceId: "s2", path: "/booking/guests", value: 6 } },
    });
    expect(events[2]).toMatchObject({ origin: "knob", msg: { updateDataModel: { path: "/booking/time", value: ["20:00"] } } });
    expect(events[3]).toEqual({ type: "caption", text: "Guests 6 · Time 20:00" });
    expect(events.some((e) => e.type === "usage")).toBe(false);
    expect(llm.prompts).toHaveLength(0);
  });

  test("route says compose → route event, then the composer runs", async () => {
    const compose: RouteResult = { ...patchRoute(), kind: "new", decision: "compose", patches: [], reason: "kind new" };
    const events = await collect(request(), deps({ route: async () => compose, llm: fakeLlm([MINIMAL]) }));
    expect(events.map((e) => e.type)).toEqual(["route", "a2ui", "caption", "usage", "done"]);
  });

  test("patch decision with zero patches composes", async () => {
    const odd: RouteResult = { ...patchRoute(), patches: [] };
    const events = await collect(request(), deps({ route: async () => odd, llm: fakeLlm([MINIMAL]) }));
    expect(events.map((e) => e.type)).toEqual(["route", "a2ui", "caption", "usage", "done"]);
  });

  test("a throwing router falls through to compose", async () => {
    const events = await collect(
      request(),
      deps({
        route: async () => {
          throw new Error("jev down");
        },
        llm: fakeLlm([MINIMAL]),
      }),
    );
    expect(events[0]).toMatchObject({ type: "route", decision: "compose", reason: "router threw: jev down" });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  test("a hanging router is cut off by the guard", async () => {
    const events = await collect(request(), deps({ route: () => new Promise(() => {}), routeGuardMs: 20, llm: fakeLlm([MINIMAL]) }));
    expect(events[0]).toMatchObject({ type: "route", decision: "compose" });
    expect(events.map((e) => e.type)).toEqual(["route", "a2ui", "caption", "usage", "done"]);
  });

  test("no route when decision is off, there are no knobs, or the input is a tap", async () => {
    const llm = () => fakeLlm([MINIMAL]);
    for (const req of [
      request({ decision: false }),
      request({ surface: { ...request().surface!, knobs: [] } }),
      request({ input: { type: "action", action: { name: "pick_place", surfaceId: "s1", sourceComponentId: "place", timestamp: "t", context: { id: "p1" } } } }),
    ]) {
      const events = await collect(req, deps({ llm: llm() }));
      expect(events.map((e) => e.type)).toEqual(["a2ui", "caption", "usage", "done"]);
    }
  });

  test("patchCaption falls back to the path and raw values", () => {
    expect(patchCaption([{ knobId: "?", path: "/trip/return", value: true, confidence: 1 }], [])).toBe("return on");
  });
});

describe("runTurn: compose path (a2ui)", () => {
  const lines = [
    '{"a2ui":{"version":"1.0","createSurface":{"surfaceId":"s3","catalogId":"brick-box/v1"}}}',
    '{"data":{"source":"flights","args":{"to":"Oslo"},"into":"/flights"}}',
    "Sure! Here is your screen:",
    '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s3","components":[{"id":"root","component":"Card","child":"list"}]}}}',
    "```",
    '{"data":{"source":"hotels","args":{},"into":"/hotels"}}',
    '{"caption":"Places nearby"}',
  ];
  const text = lines.join("\n");
  // Split mid-line on purpose.
  const chunks = [text.slice(0, 37), text.slice(37, 150), text.slice(150, 151), text.slice(151)];

  test("emits a2ui/data/fetch/caption/usage/done in order; counts skipped lines; measures timings", async () => {
    const llm = fakeLlm(chunks);
    const events = await collect(request({ decision: false, surface: null }), deps({ llm }));
    expect(events.map((e) => e.type)).toEqual(["a2ui", "a2ui", "fetch", "a2ui", "caption", "usage", "done"]);
    const [create, data, comps] = events.filter((e) => e.type === "a2ui") as Extract<TurnEvent, { type: "a2ui" }>[];
    expect(create.origin).toBe("llm");
    // A mangled catalog id is replaced with the real one.
    expect(create.msg).toEqual({ version: "1.0", createSurface: { surfaceId: "s3", catalogId: ctx.catalogId } });
    expect(data.origin).toBe("data");
    expect(data.msg).toEqual({ version: "1.0", updateDataModel: { surfaceId: "s3", path: "/flights", value: generateFlights("Bremen", "Oslo", "2026-11-24") } });
    // Demo sources get a fetch event too, right after their data.
    expect(events[2]).toMatchObject({ type: "fetch", source: "flights", query: "Bremen → Oslo 2026-11-24", ok: true, records: 4 });
    expect(comps.origin).toBe("llm");
    const u = events[5] as Extract<TurnEvent, { type: "usage" }>;
    expect(u).toMatchObject({ model: "fake-model", input_tokens: 10, output_tokens: 20, cache_read_tokens: 5, skipped_lines: 2 });
    expect(u.first_ui_ms).toBeGreaterThan(0);
    expect(u.compose_ms).toBeGreaterThanOrEqual(u.first_ui_ms!);
    // STATE goes to the user message, the cached system prompt is static.
    expect(llm.prompts[0].cacheSystem).toBe(true);
    expect(llm.prompts[0].user).toContain('"next_surface_id":"s3"');
  });

  test("data lines target the request surface when no createSurface came first, else nextSurfaceId", async () => {
    const line = '{"data":{"source":"flights","args":{"to":"New York","from":{"@path":"/trip/from"}},"into":"/flights"}}\n';
    const withSurface = request({ decision: false, surface: { id: "s2", components: [], data: { trip: { from: "Hamburg" } }, knobs: [] } });
    const a = await collect(withSurface, deps({ llm: fakeLlm([line]) }));
    expect(a[0]).toMatchObject({ origin: "data", msg: { updateDataModel: { surfaceId: "s2", path: "/flights" } } });
    // The @path arg was read from the surface data; date defaulted to tomorrow.
    expect((a[0] as { msg: { updateDataModel: { value: unknown } } }).msg.updateDataModel.value).toEqual(generateFlights("Hamburg", "New York", "2026-11-24"));
    const b = await collect(request({ decision: false, surface: null }), deps({ llm: fakeLlm([line]) }));
    expect(b[0]).toMatchObject({ msg: { updateDataModel: { surfaceId: "s3" } } });
  });

  test("a data line before createSurface waits and goes to the new surface", async () => {
    const text = [
      '{"data":{"source":"flights","args":{"from":"Bremen","to":"New York","date":"2026-11-24"},"into":"/flights"}}',
      '{"a2ui":{"version":"1.0","createSurface":{"surfaceId":"s3","catalogId":"http://test/catalog/brick-box/v1"}}}',
      '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s3","components":[{"id":"root","component":"Card","child":"x"}]}}}',
      '{"caption":"Flights"}',
    ].join("\n");
    const events = await collect(request({ decision: false }), deps({ llm: fakeLlm([text]) }));
    expect(events.map((e) => (e.type === "a2ui" ? `${e.origin}:${Object.keys(e.msg)[1]}:${(Object.values(e.msg)[1] as { surfaceId: string }).surfaceId}` : e.type))).toEqual([
      "llm:createSurface:s3",
      "data:updateDataModel:s3",
      "fetch",
      "llm:updateComponents:s3",
      "caption",
      "usage",
      "done",
    ]);
  });

  test("a held data line follows the surface of the next message, or the fallback at the end", async () => {
    const data = '{"data":{"source":"flights","args":{"to":"Oslo"},"into":"/flights"}}';
    const comps = '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s9","components":[]}}}';
    const a = await collect(request({ decision: false }), deps({ llm: fakeLlm([`${data}\n${comps}\n`]) }));
    expect(a[0]).toMatchObject({ origin: "data", msg: { updateDataModel: { surfaceId: "s9" } } });
    const b = await collect(request({ decision: false }), deps({ llm: fakeLlm([`${data}\n{"caption":"x"}\n`]) }));
    expect(b.map((e) => e.type)).toEqual(["a2ui", "fetch", "caption", "usage", "done"]);
    expect(b[0]).toMatchObject({ msg: { updateDataModel: { surfaceId: "s2" } } });
  });

  test("a trailing line without newline is still handled", async () => {
    const line = '{"a2ui":{"version":"1.0","deleteSurface":{"surfaceId":"s1"}}}';
    const events = await collect(request({ decision: false }), deps({ llm: fakeLlm([line]) }));
    expect(events.map((e) => e.type)).toEqual(["a2ui", "usage", "done"]);
  });

  test("a caption-only answer is retried once with a note; usage sums both calls", async () => {
    const answers = ['{"caption":"only words"}\n', MINIMAL];
    const prompts: Prompt[] = [];
    const llm: Llm = {
      streamText(p) {
        prompts.push(p);
        return fakeStream([answers[prompts.length - 1]]);
      },
      async callTools() {
        throw new Error("unused");
      },
    };
    const events = await collect(request({ decision: false }), deps({ llm }));
    // The first attempt's caption described a screen that was never built: it is dropped.
    expect(events.map((e) => e.type)).toEqual(["a2ui", "caption", "usage", "done"]);
    expect(events[1]).toEqual({ type: "caption", text: "x" });
    expect(prompts).toHaveLength(2);
    expect(prompts[1].user).toBe(`${prompts[0].user}\n${COMPOSER_RETRY_NOTE}`);
    expect(events[2]).toMatchObject({ input_tokens: 20, output_tokens: 40, cache_read_tokens: 10 });
  });

  test("still no A2UI line after the retry → usage, then error", async () => {
    const llm = fakeLlm(['{"caption":"only words"}\n']);
    const events = await collect(request({ decision: false }), deps({ llm }));
    expect(events.map((e) => e.type)).toEqual(["usage", "error", "done"]);
    expect(events[1]).toEqual({ type: "error", message: "The composer returned no screen" });
    expect(llm.prompts).toHaveLength(2);
  });
});

describe("runTurn: stop reasons, repairs, captions", () => {
  const create = '{"a2ui":{"version":"1.0","createSurface":{"surfaceId":"s3","catalogId":"http://test/catalog/brick-box/v1"}}}';
  const comps = (closers: string) =>
    `{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s3","components":[{"id":"root","component":"Card","child":"x","action":{"event":{"name":"go","context":{"id":{"@path":"id"${closers}`;
  const good = comps("}}}}}]}}}");

  test("max_tokens: the cut-off last line is skipped (not repaired); the screen so far stays, no error", async () => {
    const warnings: string[] = [];
    const cut = '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s3","components":[{"id":"root","component":"Card","child":"main"}';
    const events = await collect(
      request({ decision: false }),
      deps({ llm: fakeLlm([`${create}\n${cut}`], { stopReason: "max_tokens" }), warn: (m) => void warnings.push(m) }),
    );
    expect(events.map((e) => e.type)).toEqual(["a2ui", "usage", "done"]);
    expect(events[1]).toMatchObject({ skipped_lines: 1, repaired_lines: 0 });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith("composer line skipped (invalid JSON)");
  });

  test("max_tokens with no screen → error, no retry", async () => {
    const llm = fakeLlm(['{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s3","compo'], { stopReason: "max_tokens" });
    const events = await collect(request({ decision: false }), deps({ llm, warn: () => {} }));
    expect(events.map((e) => e.type)).toEqual(["usage", "error", "done"]);
    expect(events[1]).toEqual({ type: "error", message: "The composer ran out of tokens before showing anything" });
    expect(llm.prompts).toHaveLength(1);
  });

  test("refusal → error after usage, in every mode", async () => {
    const a = await collect(request({ decision: false }), deps({ llm: fakeLlm([`${create}\n`], { stopReason: "refusal" }) }));
    expect(a.map((e) => e.type)).toEqual(["a2ui", "usage", "error", "done"]);
    expect(a[2]).toEqual({ type: "error", message: "Claude declined this request" });
    const h = await collect(request({ mode: "html", decision: false }), deps({ llm: fakeLlm([], { stopReason: "refusal" }) }));
    expect(h.map((e) => e.type)).toEqual(["usage", "error", "done"]);
    const reply: WidgetsReply = { tool: null, text: "I can't help with that.", usage, stopReason: "refusal" };
    const w = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, reply) }));
    expect(w.map((e) => e.type)).toEqual(["usage", "error", "done"]);
  });

  test("html cut off by max_tokens after some HTML: no error (the page so far is shown)", async () => {
    const events = await collect(request({ mode: "html", decision: false }), deps({ llm: fakeLlm(["<p>hi"], { stopReason: "max_tokens" }) }));
    expect(events.map((e) => e.type)).toEqual(["html", "usage", "done"]);
  });

  test("widgets: a tool call cut off by max_tokens is never rendered", async () => {
    const reply: WidgetsReply = { tool: { name: "show_restaurants", input: {} }, text: "", usage, stopReason: "max_tokens" };
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, reply) }));
    expect(events.map((e) => e.type)).toEqual(["usage", "error", "done"]);
  });

  test("a miscounted closing run on a complete line is repaired, counted and logged", async () => {
    const warnings: string[] = [];
    const extra = comps("}}}}}}]}}}");
    expect(() => JSON.parse(extra)).toThrow();
    const events = await collect(
      request({ decision: false }),
      deps({ llm: fakeLlm([`${create}\n${extra}\n${good}\n{"caption":"x"}\n`]), warn: (m) => void warnings.push(m) }),
    );
    expect(events.map((e) => e.type)).toEqual(["a2ui", "a2ui", "a2ui", "caption", "usage", "done"]);
    expect(events[4]).toMatchObject({ skipped_lines: 0, repaired_lines: 1 });
    expect(warnings).toEqual([expect.stringContaining("composer line repaired")]);
  });

  test("a check written without its condition wrapper is wrapped (the client would refuse the Button)", async () => {
    const good = { condition: { "@call": "required", args: { value: { "@path": "/f/from" } } }, message: "From" };
    const bare = { "@call": "required", args: { value: { "@path": "/f/to" } }, message: "To" };
    const button = { id: "go", component: "Button", child: "l", action: { event: { name: "search", context: {} } }, "@checks": [good, bare] };
    const line = JSON.stringify({ a2ui: { version: "1.0", updateComponents: { surfaceId: "s3", components: [button] } } });
    const warnings: string[] = [];
    const events = await collect(request({ decision: false }), deps({ llm: fakeLlm([`${create}\n${line}\n`]), warn: (m) => void warnings.push(m) }));
    const sent = (events[1] as unknown as { msg: { updateComponents: { components: { "@checks": unknown }[] } } }).msg.updateComponents.components[0];
    expect(sent["@checks"]).toEqual([good, { condition: { "@call": "required", args: { value: { "@path": "/f/to" } } }, message: "To" }]);
    expect(warnings).toEqual([expect.stringContaining("composer @checks fixed (1 bare condition)")]);
    // Well-formed messages pass through untouched (same object).
    const ok = { version: "1.0" as const, updateComponents: { surfaceId: "s3", components: [{ ...button, "@checks": [good] }] } };
    expect(fixChecks(ok)).toEqual({ msg: ok, fixed: 0 });
    expect(fixChecks(ok).msg).toBe(ok);
  });

  test("at most one caption per turn, sent after the screen", async () => {
    const events = await collect(request({ decision: false }), deps({ llm: fakeLlm([`{"caption":"early"}\n${create}\n{"caption":"late"}\n`]) }));
    expect(events.filter((e) => e.type === "caption")).toEqual([{ type: "caption", text: "late" }]);
    expect(events.map((e) => e.type)).toEqual(["a2ui", "caption", "usage", "done"]);
  });
});

describe("runTurn: live search data lines", () => {
  const CREATE = '{"a2ui":{"version":"1.0","createSurface":{"surfaceId":"s3","catalogId":"http://test/catalog/brick-box/v1"}}}';
  const ROOT = '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s3","components":[{"id":"root","component":"List","children":{"path":"/results","componentId":"item"}}]}}}';
  const QUERY = "concerts in Hamburg December 2026";
  const SEARCH = `{"data":{"source":"search","args":{"query":"${QUERY}","fields":["name","subtitle","id"],"max":9},"into":"/results"}}`;
  const items = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `r${i + 1}`, name: `Item ${i + 1}`, subtitle: null, source: `https://example.org/${i}` }));
  const found = (n: number): SearchOutcome => ({
    ok: true,
    records: items(n),
    dropped: 0,
    searches: 1,
    inputTokens: 15000,
    outputTokens: 800,
  });
  const label = (e: TurnEvent) => (e.type === "a2ui" ? `${e.origin}:${Object.keys(e.msg)[1]}` : e.type);
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  const valueOf = (e: TurnEvent | undefined) => (e as { msg: { updateDataModel: { surfaceId: string; path: string; value: unknown } } }).msg.updateDataModel;

  test("the search starts as soon as its line parses, runs beside the stream, and done waits for it", async () => {
    const log: string[] = [];
    const started = deferred<void>();
    const answer = deferred<SearchOutcome>();
    const llm: Llm = {
      streamText() {
        return {
          async *[Symbol.asyncIterator]() {
            yield `${CREATE}\n${ROOT}\n${SEARCH}\n`;
            // The stream cannot go on until the search has started: proof of the parallel start.
            await started.promise;
            log.push("stream: more lines");
            yield '{"caption":"Concerts"}\n';
            log.push("stream: end");
          },
          async result() {
            return { usage, stopReason: "end_turn" };
          },
          abort() {},
        };
      },
      async callTools() {
        throw new Error("unused");
      },
    };
    let seen: SearchRequest | null = null;
    const search = async (r: SearchRequest) => {
      seen = r;
      log.push("search: start");
      started.resolve();
      return answer.promise;
    };
    const events: TurnEvent[] = [];
    await runTurn(request({ decision: false }), deps({ llm, search }), (ev) => {
      events.push(ev);
      // The search answers only after the compose stream has finished.
      if (ev.type === "usage") setTimeout(() => answer.resolve(found(2)), 5);
    });
    expect(log).toEqual(["search: start", "stream: more lines", "stream: end"]);
    // id is server-owned, so it is not asked for; max is capped.
    expect(seen!).toEqual({ query: QUERY, fields: ["name", "subtitle"], max: 6 });
    expect(events.map(label)).toEqual(["llm:createSurface", "llm:updateComponents", "caption", "usage", "data:updateDataModel", "fetch", "done"]);
    expect(valueOf(events[4])).toEqual({ surfaceId: "s3", path: "/results", value: items(2) });
    const f = events[5] as Extract<TurnEvent, { type: "fetch" }>;
    expect(f).toMatchObject({ type: "fetch", source: "search", query: QUERY, ok: true, records: 2, searches: 1, input_tokens: 15000, output_tokens: 800 });
    expect(f.ms).toBeGreaterThan(0);
    expect(f.error).toBeUndefined();
  });

  test("a search past its budget: [] then fetch ok:false, the request is cancelled, then done", async () => {
    const warnings: string[] = [];
    let cancelled = false;
    const search = (_r: SearchRequest, signal: AbortSignal) => {
      signal.addEventListener("abort", () => (cancelled = true));
      return new Promise<SearchOutcome>(() => {});
    };
    const llm = fakeLlm([`${CREATE}\n${ROOT}\n${SEARCH}\n{"caption":"x"}\n`]);
    const events = await collect(request({ decision: false }), deps({ llm, search, fetchTimeoutMs: 30, warn: (m) => void warnings.push(m) }));
    expect(events.map(label)).toEqual(["llm:createSurface", "llm:updateComponents", "caption", "usage", "data:updateDataModel", "fetch", "done"]);
    expect(valueOf(events[4]).value).toEqual([]);
    expect(events[5]).toEqual({ type: "fetch", source: "search", query: QUERY, ok: false, records: 0, ms: expect.any(Number), error: "timed out after 30 ms" });
    expect(cancelled).toBe(true);
    expect(warnings).toEqual([`search failed (timed out after 30 ms): ${QUERY}`]);
  });

  test("the turn budget caps a fetch below its own timeout", async () => {
    const llm = fakeLlm([`${CREATE}\n${SEARCH}\n`]);
    const t0 = performance.now();
    const events = await collect(
      request({ decision: false }),
      deps({ llm, search: () => new Promise<SearchOutcome>(() => {}), now: () => performance.now(), fetchTimeoutMs: 10_000, turnBudgetMs: 60 }),
    );
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(events.find((e) => e.type === "fetch")).toMatchObject({ ok: false, error: expect.stringMatching(/^timed out after \d+ ms$/) });
  });

  test("a failed search delivers [] with its measured tokens and error", async () => {
    const failed: SearchOutcome = { ok: false, error: "no web search was made", searches: 0, inputTokens: 900, outputTokens: 40 };
    const events = await collect(request({ decision: false }), deps({ llm: fakeLlm([`${CREATE}\n${SEARCH}\n`]), search: async () => failed }));
    expect(valueOf(events.find((e) => e.type === "a2ui" && e.origin === "data")).value).toEqual([]);
    expect(events.find((e) => e.type === "fetch")).toEqual({
      type: "fetch",
      source: "search",
      query: QUERY,
      ok: false,
      records: 0,
      ms: expect.any(Number),
      searches: 0,
      input_tokens: 900,
      output_tokens: 40,
      error: "no web search was made",
    });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  test("a throwing search and a missing search dep both fail visibly", async () => {
    const a = await collect(
      request({ decision: false }),
      deps({
        llm: fakeLlm([`${CREATE}\n${SEARCH}\n`]),
        search: async () => {
          throw new Error("socket hang up");
        },
      }),
    );
    expect(a.find((e) => e.type === "fetch")).toMatchObject({ ok: false, error: "Fetch failed: socket hang up" });
    const b = await collect(request({ decision: false }), deps({ llm: fakeLlm([`${CREATE}\n${SEARCH}\n`]) }));
    expect(b.find((e) => e.type === "fetch")).toMatchObject({ ok: false, error: "live search is not configured" });
  });

  test("a search line without a query is skipped and counted, no fetch", async () => {
    const line = '{"data":{"source":"search","args":{"fields":["name"]},"into":"/results"}}';
    let called = false;
    const events = await collect(
      request({ decision: false }),
      deps({
        llm: fakeLlm([`${CREATE}\n${line}\n`]),
        search: async () => {
          called = true;
          return found(1);
        },
      }),
    );
    expect(called).toBe(false);
    expect(events.some((e) => e.type === "fetch")).toBe(false);
    expect(events.find((e) => e.type === "usage")).toMatchObject({ skipped_lines: 1 });
  });

  test("a result that arrives before createSurface waits for it, then data and fetch follow", async () => {
    const llm: Llm = {
      streamText() {
        return {
          async *[Symbol.asyncIterator]() {
            yield `${SEARCH}\n`;
            await new Promise((r) => setTimeout(r, 20));
            yield `${CREATE}\n${ROOT}\n{"caption":"x"}\n`;
          },
          async result() {
            return { usage, stopReason: "end_turn" };
          },
          abort() {},
        };
      },
      async callTools() {
        throw new Error("unused");
      },
    };
    const events = await collect(request({ decision: false }), deps({ llm, search: async () => found(1) }));
    expect(events.map(label)).toEqual(["llm:createSurface", "data:updateDataModel", "fetch", "llm:updateComponents", "caption", "usage", "done"]);
    expect(valueOf(events[1]).surfaceId).toBe("s3");
  });

  test("search data is not the first UI: a search-only answer is retried, and the repeated line reuses the search", async () => {
    const answers = [`${SEARCH}\n{"caption":"x"}\n`, `${CREATE}\n${SEARCH}\n${ROOT}\n{"caption":"y"}\n`];
    const prompts: Prompt[] = [];
    const llm: Llm = {
      streamText(p) {
        prompts.push(p);
        return fakeStream([answers[prompts.length - 1]]);
      },
      async callTools() {
        throw new Error("unused");
      },
    };
    let calls = 0;
    const search = async () => {
      calls++;
      return found(3);
    };
    const events = await collect(request({ decision: false }), deps({ llm, search }));
    expect(prompts).toHaveLength(2);
    expect(calls).toBe(1);
    expect(events.filter((e) => e.type === "fetch")).toHaveLength(1);
    // The retry's List is on s3: the reused search must fill s3, not the current surface s2.
    const data = events.filter((e) => e.type === "a2ui" && e.origin === "data");
    expect(data).toHaveLength(1);
    expect(valueOf(data[0])).toMatchObject({ surfaceId: "s3", path: "/results" });
    expect(events.find((e) => e.type === "usage")).toMatchObject({ first_ui_ms: expect.any(Number) });
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  /** Attempt 1 writes only the search line and a caption; the retry builds s3 and repeats the line. */
  async function retriedSearch(opts: { searchMs: number; captionDelayMs: number }) {
    let attempt = 0;
    const llm: Llm = {
      streamText() {
        attempt++;
        const first = attempt === 1;
        return {
          async *[Symbol.asyncIterator]() {
            if (first) {
              yield `${SEARCH}\n`;
              await new Promise((r) => setTimeout(r, opts.captionDelayMs));
              yield '{"caption":"x"}\n';
            } else {
              yield `${CREATE}\n${SEARCH}\n${ROOT}\n{"caption":"y"}\n`;
            }
          },
          async result() {
            return { usage, stopReason: "end_turn" };
          },
          abort() {},
        };
      },
      async callTools() {
        throw new Error("unused");
      },
    };
    let calls = 0;
    const search = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, opts.searchMs));
      return found(2);
    };
    const events = await collect(request({ decision: false }), deps({ llm, search }));
    return { events, calls, data: events.filter((e) => e.type === "a2ui" && e.origin === "data") };
  }

  test("a reused search that finished before attempt 1's caption still fills the retry's surface", async () => {
    const { events, calls, data } = await retriedSearch({ searchMs: 0, captionDelayMs: 20 });
    expect(calls).toBe(1);
    expect(data).toHaveLength(1);
    expect(valueOf(data[0]).surfaceId).toBe("s3");
    // Held until the retry's createSurface, then data and its fetch event, once.
    expect(events.map(label)).toEqual(["llm:createSurface", "data:updateDataModel", "fetch", "llm:updateComponents", "caption", "usage", "done"]);
  });

  test("a reused search that finishes after the retry's createSurface fills the retry's surface", async () => {
    const { calls, data, events } = await retriedSearch({ searchMs: 40, captionDelayMs: 0 });
    expect(calls).toBe(1);
    expect(data).toHaveLength(1);
    expect(valueOf(data[0]).surfaceId).toBe("s3");
    expect(events.filter((e) => e.type === "fetch")).toHaveLength(1);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  test("the compose timeout does not cut a running search: error, then the data, then done", async () => {
    const llm = fakeLlm([`${CREATE}\n${SEARCH}\n`], { hang: true });
    const search = () => new Promise<SearchOutcome>((r) => setTimeout(() => r(found(2)), 60));
    const events = await collect(request({ decision: false }), deps({ llm, search, composeTimeoutMs: 30 }));
    expect(events.map(label)).toEqual(["llm:createSurface", "error", "data:updateDataModel", "fetch", "done"]);
    expect(events[1]).toEqual({ type: "error", message: "The composer took too long" });
    expect(events[3]).toMatchObject({ ok: true, records: 2 });
  });

  test("at most 3 searches per turn: 5 search lines start 3 fetches, the other 2 get [] and 'too many searches'", async () => {
    expect(MAX_SEARCHES_PER_TURN).toBe(3);
    const lines = [1, 2, 3, 4, 5].map((i) => `{"data":{"source":"search","args":{"query":"thing ${i}","fields":["name"]},"into":"/r${i}"}}`);
    const started: string[] = [];
    const warnings: string[] = [];
    const search = async (r: SearchRequest) => {
      started.push(r.query);
      await new Promise((res) => setTimeout(res, 10));
      return found(1);
    };
    const events = await collect(
      request({ decision: false }),
      deps({ llm: fakeLlm([`${CREATE}\n${lines.join("\n")}\n{"caption":"x"}\n`]), search, warn: (m) => void warnings.push(m) }),
    );
    expect(started).toEqual(["thing 1", "thing 2", "thing 3"]);
    const fetches = events.filter((e) => e.type === "fetch") as Extract<TurnEvent, { type: "fetch" }>[];
    expect(fetches.filter((f) => f.ok).map((f) => f.query).sort()).toEqual(["thing 1", "thing 2", "thing 3"]);
    expect(fetches.filter((f) => !f.ok)).toEqual([
      { type: "fetch", source: "search", query: "thing 4", ok: false, records: 0, ms: 0, error: "too many searches" },
      { type: "fetch", source: "search", query: "thing 5", ok: false, records: 0, ms: 0, error: "too many searches" },
    ]);
    // The rejected paths get [] at once, so their lists read "Nothing found" instead of a skeleton.
    const rejected = events.filter((e) => e.type === "a2ui" && e.origin === "data").map(valueOf).filter((u) => u.path === "/r4" || u.path === "/r5");
    expect(rejected).toEqual([
      { surfaceId: "s3", path: "/r4", value: [] },
      { surfaceId: "s3", path: "/r5", value: [] },
    ]);
    expect(warnings.filter((w) => w.startsWith("search not started"))).toHaveLength(2);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  test("the client going away cancels running searches and ends with done only", async () => {
    const ctl = new AbortController();
    let signal: AbortSignal | null = null;
    const search = (_r: SearchRequest, s: AbortSignal) => {
      signal = s;
      return new Promise<SearchOutcome>(() => {});
    };
    const p = collect(request({ decision: false }), deps({ llm: fakeLlm([`${CREATE}\n${SEARCH}\n{"caption":"x"}\n`]), search }), ctl.signal);
    setTimeout(() => ctl.abort(), 20);
    const events = await p;
    expect(events.map(label)).toEqual(["llm:createSurface", "caption", "usage", "done"]);
    expect(signal!.aborted).toBe(true);
  });
});

describe("runTurn: errors and timeouts", () => {
  test("LLM error → error + done, no usage", async () => {
    const events = await collect(request({ decision: false }), deps({ llm: fakeLlm(['{"a2ui":{"version":"1.0","deleteSurface":{"surfaceId":"s9"}}}\n', "more"], { failAfter: 1 }) }));
    expect(events.map((e) => e.type)).toEqual(["a2ui", "error", "done"]);
    expect(events[1]).toEqual({ type: "error", message: "Composer failed: stream broke" });
  });

  test("LLM that throws on start → error + done", async () => {
    const llm: Llm = {
      streamText() {
        throw new Error("no client");
      },
      async callTools() {
        throw new Error("no client");
      },
    };
    for (const mode of ["a2ui", "widgets", "html"] as const) {
      const events = await collect(request({ mode, decision: false }), deps({ llm }));
      expect(events.map((e) => e.type)).toEqual(["error", "done"]);
    }
  });

  test("compose timeout → 'The composer took too long' + done", async () => {
    const events = await collect(request({ decision: false }), deps({ llm: fakeLlm(['{"a2ui":{"version":"1.0","deleteSurface":{"surfaceId":"s9"}}}\n'], { hang: true }), composeTimeoutMs: 30 }));
    expect(events.map((e) => e.type)).toEqual(["a2ui", "error", "done"]);
    expect(events[1]).toEqual({ type: "error", message: "The composer took too long" });
  });

  test("client abort ends quietly with done", async () => {
    const ctl = new AbortController();
    const p = collect(request({ decision: false }), deps({ llm: fakeLlm([], { hang: true }) }), ctl.signal);
    setTimeout(() => ctl.abort(), 10);
    const events = await p;
    expect(events).toEqual([{ type: "done" }]);
  });
});

describe("runTurn: widgets and html modes", () => {
  test("widgets: tool call → widget with resolved places, then usage + done", async () => {
    const reply: WidgetsReply = { tool: { name: "show_restaurants", input: { kind: "vegan" } }, text: "", usage, stopReason: "tool_use" };
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, reply) }));
    expect(events.map((e) => e.type)).toEqual(["widget", "usage", "done"]);
    expect(events[0]).toMatchObject({ type: "widget", name: "RestaurantWidget", props: { kind: "vegan" } });
    const u = events[1] as Extract<TurnEvent, { type: "usage" }>;
    expect(u.first_ui_ms).toBe(u.compose_ms);
  });

  test("widgets: no tool → text", async () => {
    const reply: WidgetsReply = { tool: null, text: "Each pays 30 euro.", usage, stopReason: "end_turn" };
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, reply) }));
    expect(events.slice(0, 1)).toEqual([{ type: "text", delta: "Each pays 30 euro." }]);
  });

  test("widgetEvent: flights only when from and to are known", () => {
    const d = { from: "Bremen", date: "2026-11-24" };
    expect(widgetEvent({ name: "show_flight_search", input: { date: "2026-11-24" } }, d)).toEqual({
      type: "widget",
      name: "FlightSearchWidget",
      props: { flights: [], date: "2026-11-24" },
    });
    const full = widgetEvent({ name: "show_flight_search", input: { from: "Bremen", to: "New York" } }, d);
    expect(full?.props.flights).toEqual(generateFlights("Bremen", "New York", "2026-11-24"));
    expect(widgetEvent({ name: "unknown_tool", input: {} }, d)).toBeNull();
  });

  test("html: deltas forwarded with fences stripped, then usage + done", async () => {
    const events = await collect(request({ mode: "html", decision: false }), deps({ llm: fakeLlm(["```ht", "ml\n<p>pink", "</p>\n```"]) }));
    const html = events.filter((e) => e.type === "html").map((e) => (e as { delta: string }).delta).join("");
    expect(html).toBe("<p>pink</p>\n");
    expect(events.slice(-2).map((e) => e.type)).toEqual(["usage", "done"]);
  });
});

describe("parseTurnRequest", () => {
  const ok = { mode: "a2ui", decision: true, input: { type: "utterance", text: " hi " }, thread: [], surface: null, nextSurfaceId: "s1" };

  test("accepts a valid request and trims the utterance", () => {
    const r = parseTurnRequest(ok);
    expect(r.ok && r.req.input).toEqual({ type: "utterance", text: "hi" });
  });

  test("keeps only the last 6 thread entries", () => {
    const thread = Array.from({ length: 9 }, (_, i) => ({ role: "user", text: String(i) }));
    const r = parseTurnRequest({ ...ok, thread });
    expect(r.ok && r.req.thread.map((t) => t.text)).toEqual(["3", "4", "5", "6", "7", "8"]);
  });

  test("rejects bad shapes with a message", () => {
    const bad: [unknown, string][] = [
      [null, "body must be a JSON object"],
      [{ ...ok, mode: "voice" }, "mode must be one of a2ui, widgets, html"],
      [{ ...ok, decision: "yes" }, "decision must be a boolean"],
      [{ ...ok, input: { type: "utterance", text: "   " } }, "utterance is empty"],
      [{ ...ok, input: { type: "utterance", text: "x".repeat(401) } }, "utterance is longer than 400 characters"],
      [{ ...ok, input: { type: "typing" } }, 'input.type must be "utterance" or "action"'],
      [{ ...ok, input: { type: "action", action: { name: "x" } } }, "input.action must have name, surfaceId, sourceComponentId, timestamp and context"],
      [{ ...ok, thread: [{ role: "system", text: "x" }] }, "thread entries must be {role: user|agent|tap, text}"],
      [{ ...ok, surface: { id: "s1", components: "x", data: {}, knobs: [] } }, "surface.components must be [{id, component}]"],
      [{ ...ok, nextSurfaceId: "" }, "nextSurfaceId must be a non-empty string"],
    ];
    for (const [body, message] of bad) expect(parseTurnRequest(body)).toEqual({ ok: false, message });
  });
});
