import { describe, expect, test } from "bun:test";
import type { Knob, RouteResult, TurnEvent, TurnRequest } from "@shared/protocol";
import type { Llm, LlmUsage, Prompt, TextStream, ThinkingSetting, WidgetsReply } from "./claude";
import type { SearchOutcome, SearchRequest } from "./search";
import { COMPOSER_RETRY_NOTE, composerUnreachableNote } from "./prompts";
import {
  bindsPath,
  childIds,
  encodeEvent,
  fixChecks,
  fixIcons,
  MAX_IMAGE_LOOKUPS,
  MAX_SEARCHES_PER_TURN,
  normalizeInputValue,
  parseTurnRequest,
  patchCaption,
  runTurn,
  SSE_HEADERS,
  sseResponse,
  unreachableIds,
  widgetSearch,
  type TurnDeps,
} from "./turn";

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

  test("emits a2ui/caption/usage/done in order; skips prose and data lines of unknown sources; measures timings", async () => {
    const llm = fakeLlm(chunks);
    const warnings: string[] = [];
    const events = await collect(request({ decision: false, surface: null }), deps({ llm, warn: (m) => void warnings.push(m) }));
    expect(events.map((e) => e.type)).toEqual(["a2ui", "a2ui", "caption", "usage", "done"]);
    const [create, comps] = events.filter((e) => e.type === "a2ui") as Extract<TurnEvent, { type: "a2ui" }>[];
    expect(create.origin).toBe("llm");
    // A mangled catalog id is replaced with the real one.
    expect(create.msg).toEqual({ version: "1.0", createSurface: { surfaceId: "s3", catalogId: ctx.catalogId } });
    expect(comps.origin).toBe("llm");
    // The removed demo source ("flights") is skipped like any unknown source: no data, no fetch event.
    expect(warnings).toContainEqual(expect.stringContaining('composer line skipped (unknown data source "flights")'));
    expect(warnings).toContainEqual(expect.stringContaining('composer line skipped (unknown data source "hotels")'));
    const u = events[3] as Extract<TurnEvent, { type: "usage" }>;
    expect(u).toMatchObject({ model: "fake-model", input_tokens: 10, output_tokens: 20, cache_read_tokens: 5, skipped_lines: 3 });
    expect(u.first_ui_ms).toBeGreaterThan(0);
    expect(u.compose_ms).toBeGreaterThanOrEqual(u.first_ui_ms!);
    // STATE goes to the user message, the cached system prompt is static.
    expect(llm.prompts[0].cacheSystem).toBe(true);
    expect(llm.prompts[0].user).toContain('"next_surface_id":"s3"');
  });

  const flightRecords = [{ id: "r1", carrier: "Lufthansa", route: "BRE → JFK · 1 stop via FRA", price: "from €476", tags: ["round trip"], source: "https://example.org/lh" }];
  const flightSearch = (asked: SearchRequest[] = []) => async (r: SearchRequest): Promise<SearchOutcome> => {
    asked.push(r);
    return { ok: true, records: flightRecords, dropped: 0, searches: 1, inputTokens: 100, outputTokens: 50 };
  };
  const isData = (e: TurnEvent) => e.type === "a2ui" && e.origin === "data";
  /** Yields `first`, waits long enough for a fake search to answer, then yields `rest`. */
  const delayed = (first: string, rest: string): Llm => ({
    streamText() {
      return {
        async *[Symbol.asyncIterator]() {
          yield first;
          await new Promise((r) => setTimeout(r, 20));
          yield rest;
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
  });

  test("data lines target the request surface when no createSurface came first, else nextSurfaceId; @path args read the surface", async () => {
    const line = '{"data":{"source":"search","args":{"query":{"@path":"/trip/query"},"fields":["carrier"]},"into":"/flights"}}\n';
    const asked: SearchRequest[] = [];
    const withSurface = request({ decision: false, surface: { id: "s2", components: [], data: { trip: { query: "flights from Hamburg to Oslo" } }, knobs: [] } });
    const a = await collect(withSurface, deps({ llm: fakeLlm([line]), search: flightSearch(asked) }));
    expect(a.find(isData)).toMatchObject({ msg: { updateDataModel: { surfaceId: "s2", path: "/flights", value: flightRecords } } });
    // The @path arg was read from the surface data.
    expect(asked[0]).toMatchObject({ query: "flights from Hamburg to Oslo", fields: ["carrier"] });
    const literal = '{"data":{"source":"search","args":{"query":"flights from Hamburg to Oslo","fields":["carrier"]},"into":"/flights"}}\n';
    const b = await collect(request({ decision: false, surface: null }), deps({ llm: fakeLlm([literal]), search: flightSearch() }));
    expect(b.find(isData)).toMatchObject({ msg: { updateDataModel: { surfaceId: "s3" } } });
  });

  test("a held search result follows the surface of the next message, or the fallback", async () => {
    const data = '{"data":{"source":"search","args":{"query":"flights from Porto to Oslo"},"into":"/flights"}}';
    const comps9 = '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s9","components":[]}}}';
    const a = await collect(request({ decision: false }), deps({ llm: delayed(`${data}\n`, `${comps9}\n{"caption":"x"}\n`), search: flightSearch() }));
    expect(a.find(isData)).toMatchObject({ msg: { updateDataModel: { surfaceId: "s9" } } });
    const comps2 = '{"a2ui":{"version":"1.0","updateComponents":{"surfaceId":"s2","components":[]}}}';
    const b = await collect(request({ decision: false }), deps({ llm: delayed(`${comps2}\n${data}\n`, '{"caption":"x"}\n'), search: flightSearch() }));
    expect(b.map((e) => (isData(e) ? "data" : e.type))).toEqual(["a2ui", "data", "fetch", "caption", "usage", "done"]);
    expect(b.find(isData)).toMatchObject({ msg: { updateDataModel: { surfaceId: "s2" } } });
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

  test("widgets: a tool call cut off by max_tokens is never rendered, and nothing is searched", async () => {
    const reply: WidgetsReply = { tool: { name: "show_restaurants", input: {} }, text: "", usage, stopReason: "max_tokens" };
    let searched = 0;
    const search = async (): Promise<SearchOutcome> => {
      searched++;
      return { ok: true, records: [], dropped: 0, searches: 1, inputTokens: 1, outputTokens: 1 };
    };
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, reply), search }));
    expect(events.map((e) => e.type)).toEqual(["usage", "error", "done"]);
    expect(searched).toBe(0);
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
    // The lone Button is not under a root, so the reachability log names it too.
    expect(warnings).toEqual([expect.stringContaining("composer @checks fixed (1 bare condition)"), expect.stringContaining("(orphans 1): s3: go")]);
    // Well-formed messages pass through untouched (same object).
    const ok = { version: "1.0" as const, updateComponents: { surfaceId: "s3", components: [{ ...button, "@checks": [good] }] } };
    expect(fixChecks(ok)).toEqual({ msg: ok, fixed: 0 });
    expect(fixChecks(ok).msg).toBe(ok);
  });

  test("an OptionCard or Button icon outside the set is dropped (the client would refuse the card); the Icon brick is left alone", () => {
    const msg = {
      version: "1.0" as const,
      updateComponents: {
        surfaceId: "s3",
        components: [
          { id: "card", component: "OptionCard", title: "A", icon: "airplane" },
          { id: "go", component: "Button", child: "l", action: { event: { name: "go" } }, icon: "check" },
          { id: "i", component: "Icon", name: "rocket" },
          { id: "c2", component: "OptionCard", title: "B", icon: null },
        ],
      },
    };
    const { msg: out, fixed } = fixIcons(msg);
    expect(fixed).toBe(1);
    const comps = (out as typeof msg).updateComponents.components;
    expect(comps[0] as unknown).toEqual({ id: "card", component: "OptionCard", title: "A" });
    expect(comps.slice(1)).toEqual(msg.updateComponents.components.slice(1));
    const clean = { version: "1.0" as const, updateComponents: { surfaceId: "s3", components: [comps[1]] } };
    expect(fixIcons(clean).msg).toBe(clean);
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


  describe("image field (og:image enrichment)", () => {
    const SEARCH_IMG = `{"data":{"source":"search","args":{"query":"${QUERY}","fields":["name","image"],"max":3},"into":"/results"}}`;
    const PHOTO = (i: number) => `https://cdn.example/${i}.jpg`;

    test("image field: records first, then one update with image urls", async () => {
      let seen: SearchRequest | null = null;
      let urls: readonly (string | null)[] = [];
      const ogImages = async (u: readonly (string | null)[]) => {
        urls = u;
        return u.map((_, i) => (i === 1 ? null : PHOTO(i)));
      };
      const events = await collect(
        request({ decision: false }),
        deps({
          llm: fakeLlm([`${CREATE}\n${ROOT}\n${SEARCH_IMG}\n{"caption":"Cafés"}\n`]),
          search: async (r) => {
            seen = r;
            return found(3);
          },
          ogImages,
        }),
      );
      // The model is never asked for image: it is not in the search fields.
      expect(seen!).toEqual({ query: QUERY, fields: ["name"], max: 3, images: true });
      expect(urls).toEqual(items(3).map((r) => r.source));
      const data = events.filter((e) => e.type === "a2ui" && e.origin === "data");
      expect(data).toHaveLength(2);
      expect(valueOf(data[0]).value).toEqual(items(3).map((r) => ({ ...r, image: null })));
      expect(valueOf(data[1])).toEqual({ surfaceId: "s3", path: "/results", value: items(3).map((r, i) => ({ ...r, image: i === 1 ? null : PHOTO(i) })) });
      // Records, their fetch event, then the photos; one fetch only (no extra search); done last.
      const order = events.map(label);
      expect(order.indexOf("fetch")).toBeGreaterThan(events.indexOf(data[0]));
      expect(events.indexOf(data[1])).toBeGreaterThan(order.indexOf("fetch"));
      expect(order.filter((l) => l === "fetch")).toHaveLength(1);
      expect(order.at(-1)).toBe("done");
    });

    test("no image found: no second update", async () => {
      const events = await collect(
        request({ decision: false }),
        deps({
          llm: fakeLlm([`${CREATE}\n${ROOT}\n${SEARCH_IMG}\n{"caption":"x"}\n`]),
          search: async () => found(2),
          ogImages: async (u) => u.map(() => null),
        }),
      );
      const data = events.filter((e) => e.type === "a2ui" && e.origin === "data");
      expect(data).toHaveLength(1);
      expect(valueOf(data[0]).value).toEqual(items(2).map((r) => ({ ...r, image: null })));
    });

    test("a search without image gets no image key and no lookup", async () => {
      let looked = false;
      const events = await collect(
        request({ decision: false }),
        deps({
          llm: fakeLlm([`${CREATE}\n${ROOT}\n${SEARCH}\n{"caption":"x"}\n`]),
          search: async () => found(2),
          ogImages: async (u) => {
            looked = true;
            return u.map(() => PHOTO(0));
          },
        }),
      );
      expect(looked).toBe(false);
      const data = events.filter((e) => e.type === "a2ui" && e.origin === "data");
      expect(data).toHaveLength(1);
      expect(valueOf(data[0]).value).toEqual(items(2));
    });

    test("a result still held for createSurface carries its images: one data message", async () => {
      const llm: Llm = {
        streamText() {
          return {
            async *[Symbol.asyncIterator]() {
              yield `${SEARCH_IMG}\n`;
              await new Promise((r) => setTimeout(r, 30));
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
      const events = await collect(request({ decision: false }), deps({ llm, search: async () => found(1), ogImages: async () => [PHOTO(7)] }));
      const data = events.filter((e) => e.type === "a2ui" && e.origin === "data");
      expect(data).toHaveLength(1);
      expect(valueOf(data[0])).toEqual({ surfaceId: "s3", path: "/results", value: [{ ...items(1)[0], image: PHOTO(7) }] });
    });

    test("lookups cover the first MAX_IMAGE_LOOKUPS records and get the turn's remaining budget (at most 1.5 s)", async () => {
      let seenUrls: readonly (string | null)[] = [];
      let seenMs = -1;
      await collect(
        request({ decision: false }),
        deps({
          llm: fakeLlm([`${CREATE}\n${ROOT}\n${SEARCH_IMG}\n{"caption":"x"}\n`]),
          search: async () => found(6),
          ogImages: async (u, _signal, timeoutMs) => {
            seenUrls = u;
            seenMs = timeoutMs;
            return u.map(() => null);
          },
        }),
      );
      expect(MAX_IMAGE_LOOKUPS).toBe(4);
      expect(seenUrls).toEqual([...items(4).map((r) => r.source), null, null]);
      expect(seenMs).toBeGreaterThan(0);
      expect(seenMs).toBeLessThanOrEqual(1500);
    });

    test("no lookup when the turn budget is nearly spent: the records stand, a warning says why", async () => {
      const warnings: string[] = [];
      let called = false;
      const events = await collect(
        request({ decision: false }),
        deps({
          llm: fakeLlm([`${CREATE}\n${ROOT}\n${SEARCH_IMG}\n{"caption":"x"}\n`]),
          search: async () => found(2),
          turnBudgetMs: 400,
          ogImages: async (u) => {
            called = true;
            return u.map(() => PHOTO(1));
          },
          warn: (m) => void warnings.push(m),
        }),
      );
      expect(called).toBe(false);
      expect(warnings).toContainEqual(expect.stringContaining("image lookup skipped for /results"));
      expect(events.filter((e) => e.type === "a2ui" && e.origin === "data")).toHaveLength(1);
    });

    test("a failing lookup keeps the records and logs; the client leaving stops it", async () => {
      const warnings: string[] = [];
      const events = await collect(
        request({ decision: false }),
        deps({
          llm: fakeLlm([`${CREATE}\n${ROOT}\n${SEARCH_IMG}\n{"caption":"x"}\n`]),
          search: async () => found(1),
          ogImages: async () => {
            throw new Error("lookup broke");
          },
          warn: (m) => void warnings.push(m),
        }),
      );
      expect(events.filter((e) => e.type === "a2ui" && e.origin === "data")).toHaveLength(1);
      expect(warnings).toContainEqual(expect.stringContaining("image lookup failed (lookup broke)"));
      expect(events.at(-1)).toEqual({ type: "done" });

      const ctl = new AbortController();
      let signalSeen: AbortSignal | null = null;
      const pending = collect(
        request({ decision: false }),
        deps({
          llm: fakeLlm([`${CREATE}\n${ROOT}\n${SEARCH_IMG}\n{"caption":"x"}\n`]),
          search: async () => found(1),
          ogImages: (u, signal) => {
            signalSeen = signal;
            setTimeout(() => ctl.abort(), 5);
            return new Promise((resolve) => signal.addEventListener("abort", () => resolve(u.map(() => PHOTO(1)))));
          },
        }),
        ctl.signal,
      );
      const after = await pending;
      expect(signalSeen!.aborted).toBe(true);
      // The photos answered after the client left: nothing more is sent.
      expect(after.filter((e) => e.type === "a2ui" && e.origin === "data")).toHaveLength(1);
    });
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

describe("runTurn: reachability and value shapes", () => {
  const CREATE = '{"a2ui":{"version":"1.0","createSurface":{"surfaceId":"s3","catalogId":"http://test/catalog/brick-box/v1"}}}';
  const comps = (surfaceId: string, list: object[]) => JSON.stringify({ a2ui: { version: "1.0", updateComponents: { surfaceId, components: list } } });
  const data = (surfaceId: string, path: string, value: unknown) => JSON.stringify({ a2ui: { version: "1.0", updateDataModel: { surfaceId, path, value } } });
  const SEARCH = '{"data":{"source":"search","args":{"query":"bookshops in Lisbon","fields":["name"]},"into":"/results"}}';
  const LIST = { id: "list", component: "List", children: { path: "/results", componentId: "item" } };
  const ITEM = { id: "item", component: "OptionCard", title: { "@path": "name" } };
  const found: SearchOutcome = { ok: true, records: [{ id: "r1", name: "A", source: "https://example.org/a" }], dropped: 0, searches: 1, inputTokens: 1, outputTokens: 1 };
  function scripted(answers: string[]): Llm & { prompts: Prompt[] } {
    const prompts: Prompt[] = [];
    return {
      prompts,
      streamText(p) {
        prompts.push(p);
        return fakeStream([answers[Math.min(prompts.length, answers.length) - 1]]);
      },
      async callTools() {
        throw new Error("unused");
      },
    };
  }
  const kindOf = (e: TurnEvent) => (e.type === "a2ui" ? `${e.origin}:${Object.keys(e.msg)[1]}` : e.type);

  test("a List left outside root while its data was requested is retried once with the ids; the retry's surface gets the data", async () => {
    const first = [CREATE, comps("s3", [{ id: "root", component: "Card", child: "main" }, { id: "main", component: "Column", children: ["title"] }, { id: "title", component: "Text", text: "## Shops" }]), SEARCH, comps("s3", [LIST]), comps("s3", [ITEM]), '{"caption":"x"}'];
    const second = [CREATE, comps("s3", [{ id: "root", component: "Card", child: "main" }, { id: "main", component: "Column", children: ["title", "list"] }, { id: "title", component: "Text", text: "## Shops" }, LIST]), SEARCH, comps("s3", [ITEM]), '{"caption":"y"}'];
    const llm = scripted([first.join("\n") + "\n", second.join("\n") + "\n"]);
    let calls = 0;
    const warnings: string[] = [];
    const events = await collect(request({ decision: false }), deps({ llm, search: async () => (calls++, found), warn: (m) => void warnings.push(m) }));
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1].user).toBe(`${llm.prompts[0].user}\n${composerUnreachableNote(["list", "item"], ["/results"])}`);
    expect(warnings).toContainEqual(expect.stringContaining("(orphans 2): s3: list, item"));
    // The repeated search line reuses the running search: one call, one fetch event.
    expect(calls).toBe(1);
    expect(events.filter((e) => e.type === "fetch")).toHaveLength(1);
    // The retry re-creates s3 (the client starts it over), so the data must come after that createSurface.
    const labels = events.map(kindOf);
    const lastCreate = labels.lastIndexOf("llm:createSurface");
    const lastData = labels.lastIndexOf("data:updateDataModel");
    expect(lastData).toBeGreaterThan(lastCreate);
    expect((events[lastData] as { msg: { updateDataModel: { surfaceId: string; path: string } } }).msg.updateDataModel).toMatchObject({ surfaceId: "s3", path: "/results" });
    // One caption per turn: attempt 1's described the screen that was rebuilt.
    expect(events.filter((e) => e.type === "caption")).toEqual([{ type: "caption", text: "y" }]);
    expect(events.at(-1)).toEqual({ type: "done" });
  });

  test("a retry that rewords the search reuses the first search for that path: one call, records kept", async () => {
    const reworded = '{"data":{"source":"search","args":{"query":"second-hand bookshops, Lisbon centre","fields":["name","subtitle"]},"into":"/results"}}';
    const top = comps("s3", [{ id: "root", component: "Card", child: "main" }, { id: "main", component: "Column", children: ["title"] }, { id: "title", component: "Text", text: "## Shops" }]);
    const fixed = comps("s3", [{ id: "root", component: "Card", child: "main" }, { id: "main", component: "Column", children: ["title", "list"] }, { id: "title", component: "Text", text: "## Shops" }, LIST]);
    const llm = scripted([[CREATE, top, SEARCH, comps("s3", [LIST]), comps("s3", [ITEM]), '{"caption":"x"}'].join("\n") + "\n", [CREATE, fixed, reworded, comps("s3", [ITEM]), '{"caption":"y"}'].join("\n") + "\n"]);
    const started: string[] = [];
    const events = await collect(request({ decision: false }), deps({ llm, search: async (r: SearchRequest) => (started.push(r.query), found) }));
    expect(llm.prompts).toHaveLength(2);
    expect(llm.prompts[1].user).toContain("The data for /results is already requested and arriving");
    expect(started).toEqual(["bookshops in Lisbon"]);
    expect(events.filter((e) => e.type === "fetch")).toHaveLength(1);
    const writes = events.flatMap((e) => (e.type === "a2ui" && e.origin === "data" && "updateDataModel" in e.msg ? [e.msg.updateDataModel] : []));
    // Never an empty list over the records: every write carries them, the last one after the retry's createSurface.
    expect(writes.length).toBeGreaterThan(0);
    for (const w of writes) expect(w).toEqual({ surfaceId: "s3", path: "/results", value: found.ok ? found.records : [] });
    const labels = events.map(kindOf);
    expect(labels.lastIndexOf("data:updateDataModel")).toBeGreaterThan(labels.lastIndexOf("llm:createSurface"));
  });

  test("an unreachable component without requested data is logged, not retried", async () => {
    const answer = [CREATE, comps("s3", [{ id: "root", component: "Card", child: "t" }, { id: "t", component: "Text", text: "hi" }, { id: "stray", component: "Text", text: "lost" }]), '{"caption":"x"}'];
    const llm = scripted([answer.join("\n") + "\n"]);
    const warnings: string[] = [];
    await collect(request({ decision: false }), deps({ llm, warn: (m) => void warnings.push(m) }));
    expect(llm.prompts).toHaveLength(1);
    expect(warnings).toEqual([expect.stringContaining("composer sent 1 component(s) not reachable from root (orphans 1): s3: stray")]);
  });

  test("an in-place update is reachable through the surface's existing ids when the parent is re-sent", async () => {
    const surface = { id: "s2", components: [{ id: "root", component: "Card" }, { id: "main", component: "Column" }], data: {}, knobs: [] };
    const warnings: string[] = [];
    const resent = comps("s2", [{ id: "main", component: "Column", children: ["extra"] }, { id: "extra", component: "Text", text: "new" }]);
    await collect(request({ decision: false, surface }), deps({ llm: scripted([`${resent}\n{"caption":"x"}\n`]), warn: (m) => void warnings.push(m) }));
    expect(warnings).toEqual([]);
    const alone = comps("s2", [{ id: "extra", component: "Text", text: "new" }]);
    await collect(request({ decision: false, surface }), deps({ llm: scripted([`${alone}\n{"caption":"x"}\n`]), warn: (m) => void warnings.push(m) }));
    expect(warnings).toEqual([expect.stringContaining("(orphans 1): s2: extra")]);
  });

  test("childIds, unreachableIds and bindsPath follow child, children, templates, tabs and Accordion items", () => {
    const c = (o: object) => o as { id: string; component: string };
    expect(childIds(c({ id: "t", component: "Tabs", tabs: [{ title: "A", child: "a" }, { title: "B", child: "b" }] }))).toEqual(["a", "b"]);
    expect(childIds(c({ id: "acc", component: "Accordion", items: [{ title: "A", child: "a" }, { title: "B", child: "b" }] }))).toEqual(["a", "b"]);
    // Chart and Timeline items are data rows, never component ids.
    expect(childIds(c({ id: "tl", component: "Timeline", items: [{ title: "A", child: "a" }] }))).toEqual([]);
    expect(childIds(c(LIST))).toEqual(["item"]);
    const map = new Map([LIST, ITEM, { id: "root", component: "Card", child: "list" }, { id: "x", component: "Text" }].map((o) => [o.id, c(o)]));
    expect(unreachableIds(map, ["root"])).toEqual(["x"]);
    expect(unreachableIds(map, [])).toEqual(["list", "item", "root", "x"]);
    expect(bindsPath(LIST, "/results")).toBe(true);
    expect(bindsPath({ title: { "@path": "/results/0/name" } }, "/results")).toBe(true);
    expect(bindsPath({ title: { "@path": "/resultsX" } }, "/results")).toBe(false);
  });

  test("input values are written in their input's shape when this turn knows the input", async () => {
    const timeKnob: Knob = {
      type: "choice",
      id: "/dinner/time",
      componentId: "time",
      component: "DateTimeInput",
      path: "/dinner/time",
      label: "Time",
      current: "19:00",
      currentLabel: "19:00",
      options: [{ key: "20:00", label: "20:00", value: "20:00" }],
    };
    const surface = { id: "s2", components: [{ id: "time", component: "DateTimeInput" }], data: { dinner: { time: "19:00" } }, knobs: [timeKnob] };
    const answer = [
      data("s2", "/dinner/time", ["20:00"]),
      CREATE,
      comps("s3", [{ id: "root", component: "Card", child: "c" }, { id: "c", component: "Column", children: ["p", "g"] }, { id: "p", component: "ChoicePicker", options: [{ label: "19:00", value: "19:00" }], value: { "@path": "/b/time" } }, { id: "g", component: "Stepper", value: { "@path": "/b/guests" } }]),
      data("s3", "/b", { time: "19:00", guests: "2", note: ["x"] }),
      '{"caption":"x"}',
    ];
    const warnings: string[] = [];
    const events = await collect(request({ decision: false, surface }), deps({ llm: scripted([answer.join("\n") + "\n"]), warn: (m) => void warnings.push(m) }));
    const values = events.flatMap((e) => (e.type === "a2ui" && "updateDataModel" in e.msg ? [e.msg.updateDataModel] : []));
    expect(values[0]).toEqual({ surfaceId: "s2", path: "/dinner/time", value: "20:00" });
    // Unknown paths (note) are left as written.
    expect(values[1]).toEqual({ surfaceId: "s3", path: "/b", value: { time: ["19:00"], guests: 2, note: ["x"] } });
    expect(warnings.filter((w) => w.startsWith("composer value shape fixed"))).toHaveLength(2);
  });

  test("normalizeInputValue fixes only unambiguous shapes", () => {
    expect(normalizeInputValue("ChoicePicker", "a")).toEqual(["a"]);
    expect(normalizeInputValue("ChoicePicker", ["a", "b"])).toEqual(["a", "b"]);
    expect(normalizeInputValue("DateTimeInput", ["2030-06-14"])).toBe("2030-06-14");
    expect(normalizeInputValue("SeatMap", ["12C"])).toBe("12C");
    expect(normalizeInputValue("TextField", [42])).toBe(42);
    expect(normalizeInputValue("TextField", 42)).toBe(42);
    expect(normalizeInputValue("Stepper", "6")).toBe(6);
    expect(normalizeInputValue("Slider", [30])).toBe(30);
    expect(normalizeInputValue("Stepper", "six")).toBe("six");
    expect(normalizeInputValue("CheckBox", "true")).toBe(true);
    expect(normalizeInputValue("Text", ["x"])).toEqual(["x"]);
  });
});

describe("runTurn: composer model", () => {
  const streamOf = (thinking?: ThinkingSetting): TextStream => ({
    async *[Symbol.asyncIterator]() {
      yield MINIMAL;
    },
    async result() {
      return { usage, stopReason: "end_turn", ...(thinking ? { thinking } : {}) };
    },
    abort() {},
  });
  const named = (name: string, used: string[], thinking?: ThinkingSetting): Llm => ({
    streamText() {
      used.push(name);
      return streamOf(thinking);
    },
    async callTools() {
      used.push(name);
      return { tool: null, text: "plain", usage, stopReason: "end_turn" };
    },
  });

  test("composerLlm composes a2ui; widgets and html stay on llm; usage carries the thinking setting that ran", async () => {
    const used: string[] = [];
    const d = deps({ llm: named("llm", used), composerLlm: named("composer", used, "between-tools") });
    const a2ui = await collect(request({ decision: false }), d);
    expect(used).toEqual(["composer"]);
    expect(a2ui.find((e) => e.type === "usage")).toMatchObject({ thinking: "between-tools" });
    await collect(request({ decision: false, mode: "widgets" }), d);
    await collect(request({ decision: false, mode: "html" }), d);
    expect(used).toEqual(["composer", "llm", "llm"]);
  });

  test("without composerLlm the composer uses llm, and the usage event has no thinking field when none is reported", async () => {
    const used: string[] = [];
    const events = await collect(request({ decision: false }), deps({ llm: named("llm", used) }));
    expect(used).toEqual(["llm"]);
    expect(events.find((e) => e.type === "usage")).not.toHaveProperty("thinking");
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
  const restaurantsReply = (input: Record<string, string | number> = {}): WidgetsReply => ({
    tool: { name: "show_restaurants", input },
    text: "",
    usage,
    stopReason: "tool_use",
  });
  const liveRecords = [
    { id: "r1", name: "Feuerwache", kind: "german", walk_min: null, price_level: "€€", tags: ["beer"], opens_until: "23:00", source: "https://feuerwache.example/" },
    { id: "r2", name: "Far Away", kind: "vegan", walk_min: 25, price_level: null, tags: null, opens_until: null, source: "https://far.example/" },
    { id: "r3", name: null, kind: "vegan", walk_min: null, price_level: null, tags: null, opens_until: null, source: "https://noname.example/" },
  ];

  test("widgets: show_restaurants runs the live search, then the widget with its records, the fetch event, usage, done", async () => {
    const asked: SearchRequest[] = [];
    const search = async (r: SearchRequest): Promise<SearchOutcome> => {
      asked.push(r);
      return { ok: true, records: liveRecords, dropped: 1, searches: 1, inputTokens: 15000, outputTokens: 700 };
    };
    const warnings: string[] = [];
    const events = await collect(
      request({ mode: "widgets", decision: false }),
      deps({ llm: fakeLlm([], {}, restaurantsReply({ kind: "vegan", max_walk_min: 10 })), search, warn: (m) => void warnings.push(m) }),
    );
    expect(asked).toEqual([
      { query: "vegan restaurants near Venue, Bremen", fields: ["name", "kind", "walk_min", "price_level", "tags", "opens_until"], max: 5 },
    ]);
    expect(events.map((e) => e.type)).toEqual(["widget", "fetch", "usage", "done"]);
    // No name → dropped; a stated 25 min walk is over the limit → dropped. Unknowns stay null.
    expect(events[0]).toEqual({
      type: "widget",
      name: "RestaurantWidget",
      props: {
        places: [{ id: "r1", name: "Feuerwache", kind: "german", walk_min: null, price_level: 2, tags: ["beer"], opens_until: "23:00", source: "https://feuerwache.example/" }],
        kind: "vegan",
      },
    });
    expect(events[1]).toEqual({
      type: "fetch",
      source: "search",
      query: "vegan restaurants near Venue, Bremen",
      ok: true,
      records: 1,
      ms: expect.any(Number),
      searches: 1,
      input_tokens: 15000,
      output_tokens: 700,
    });
    const u = events[2] as Extract<TurnEvent, { type: "usage" }>;
    // The widget waits for the search, so its first UI comes after the tool call.
    expect(u.first_ui_ms).toBeGreaterThan(u.compose_ms);
    expect(warnings).toEqual([expect.stringContaining("restaurant search dropped 1 invalid item(s)")]);
  });

  test("widgets: a failed search shows the widget with no places and a failed fetch event", async () => {
    const warnings: string[] = [];
    const search = async (): Promise<SearchOutcome> => ({ ok: false, error: "no web search was made", searches: 0, inputTokens: 900, outputTokens: 40 });
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, restaurantsReply()), search, warn: (m) => void warnings.push(m) }));
    expect(events.map((e) => e.type)).toEqual(["widget", "fetch", "usage", "done"]);
    expect(events[0]).toEqual({ type: "widget", name: "RestaurantWidget", props: { places: [] } });
    expect(events[1]).toMatchObject({ type: "fetch", source: "search", ok: false, records: 0, error: "no web search was made", searches: 0 });
    expect(warnings).toEqual([expect.stringContaining("restaurant search failed (no web search was made)")]);
  });

  test("widgets: a search over its budget times out: no places, the request is aborted, then done", async () => {
    let aborted = false;
    const search = (_r: SearchRequest, signal: AbortSignal) =>
      new Promise<SearchOutcome>(() => signal.addEventListener("abort", () => (aborted = true), { once: true }));
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, restaurantsReply()), search, fetchTimeoutMs: 30 }));
    expect(events.map((e) => e.type)).toEqual(["widget", "fetch", "usage", "done"]);
    expect(events[0]).toMatchObject({ props: { places: [] } });
    expect(events[1]).toEqual({ type: "fetch", source: "search", query: "restaurants near Venue, Bremen", ok: false, records: 0, ms: expect.any(Number), error: "timed out after 30 ms" });
    expect(aborted).toBe(true);
  });

  test("widgets: without a search dependency the widget fails visibly (no places), never with fixed data", async () => {
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, restaurantsReply()) }));
    expect(events.map((e) => e.type)).toEqual(["widget", "fetch", "usage", "done"]);
    expect(events[0]).toMatchObject({ props: { places: [] } });
    expect(events[1]).toMatchObject({ ok: false, error: "live search is not configured" });
  });

  test("widgets: the client leaving during the search cancels it and ends with done only", async () => {
    const ctl = new AbortController();
    let cancelled = false;
    const search = (_r: SearchRequest, signal: AbortSignal) =>
      new Promise<SearchOutcome>(() => signal.addEventListener("abort", () => (cancelled = true), { once: true }));
    const p = collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, restaurantsReply()), search }), ctl.signal);
    setTimeout(() => ctl.abort(), 20);
    expect(await p).toEqual([{ type: "done" }]);
    expect(cancelled).toBe(true);
  });

  const flightReply = (input: Record<string, string>): WidgetsReply => ({ tool: { name: "show_flight_search", input }, text: "", usage, stopReason: "tool_use" });

  test("widgets: show_flight_search runs the live search, then the widget with carrier/route/price/tags rows and the fetch event", async () => {
    const asked: SearchRequest[] = [];
    const records = [
      { id: "r1", carrier: "Lufthansa", route: "BRE → JFK · 1 stop via FRA", price: "from €476", tags: ["round trip"], source: "https://lufthansa.example/" },
      { id: "r2", carrier: "KLM", route: null, price: null, tags: null, source: "https://klm.example/" },
      { id: "r3", carrier: null, route: "BRE → JFK", price: "€99", tags: null, source: "https://nocarrier.example/" },
    ];
    const search = async (r: SearchRequest): Promise<SearchOutcome> => {
      asked.push(r);
      return { ok: true, records, dropped: 0, searches: 1, inputTokens: 14000, outputTokens: 300 };
    };
    const events = await collect(
      request({ mode: "widgets", decision: false }),
      deps({ llm: fakeLlm([], {}, flightReply({ from: "Bremen", to: "New York", date: "2026-11-26" })), search }),
    );
    expect(asked).toEqual([{ query: "flights from Bremen to New York on Thursday 26 November 2026", fields: ["carrier", "route", "price", "tags"], max: 4 }]);
    expect(events.map((e) => e.type)).toEqual(["widget", "fetch", "usage", "done"]);
    // No carrier → dropped; unknown route and price stay null, never a default.
    expect(events[0]).toEqual({
      type: "widget",
      name: "FlightSearchWidget",
      props: {
        flights: [
          { id: "r1", carrier: "Lufthansa", route: "BRE → JFK · 1 stop via FRA", price: "from €476", tags: ["round trip"], source: "https://lufthansa.example/" },
          { id: "r2", carrier: "KLM", route: null, price: null, tags: [], source: "https://klm.example/" },
        ],
        from: "Bremen",
        to: "New York",
        date: "2026-11-26",
      },
    });
    expect(events[1]).toMatchObject({ type: "fetch", source: "search", query: asked[0].query, ok: true, records: 2, searches: 1 });
    const u = events[2] as Extract<TurnEvent, { type: "usage" }>;
    expect(u.first_ui_ms).toBeGreaterThan(u.compose_ms);
  });

  test("widgets: a failed flight search shows the form with no rows and a failed fetch event", async () => {
    const warnings: string[] = [];
    const search = async (): Promise<SearchOutcome> => ({ ok: false, error: "web search returned no results", searches: 1 });
    const events = await collect(
      request({ mode: "widgets", decision: false }),
      deps({ llm: fakeLlm([], {}, flightReply({ from: "Bremen", to: "Oslo" })), search, warn: (m) => void warnings.push(m) }),
    );
    expect(events.map((e) => e.type)).toEqual(["widget", "fetch", "usage", "done"]);
    expect(events[0]).toEqual({ type: "widget", name: "FlightSearchWidget", props: { flights: [], from: "Bremen", to: "Oslo" } });
    expect(events[1]).toMatchObject({ type: "fetch", query: "flights from Bremen to Oslo", ok: false, records: 0, error: "web search returned no results" });
    expect(warnings).toEqual([expect.stringContaining("flight search failed (web search returned no results)")]);
  });

  test("widgets: a flight search without a destination shows the form at once, with no search", async () => {
    let searched = 0;
    const search = async (): Promise<SearchOutcome> => {
      searched++;
      return { ok: false, error: "unused" };
    };
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, flightReply({ from: "Bremen", date: "2026-11-26" })), search }));
    expect(events.map((e) => e.type)).toEqual(["widget", "usage", "done"]);
    expect(events[0]).toEqual({ type: "widget", name: "FlightSearchWidget", props: { flights: [], from: "Bremen", date: "2026-11-26" } });
    const u = events[1] as Extract<TurnEvent, { type: "usage" }>;
    // Measured when the widget is sent: one tick of the fake clock after the tool call, no search between.
    expect(u.first_ui_ms).toBe(u.compose_ms + 10);
    expect(searched).toBe(0);
  });

  test("widgets: no tool → text", async () => {
    const reply: WidgetsReply = { tool: null, text: "Each pays 30 euro.", usage, stopReason: "end_turn" };
    const events = await collect(request({ mode: "widgets", decision: false }), deps({ llm: fakeLlm([], {}, reply) }));
    expect(events.slice(0, 1)).toEqual([{ type: "text", delta: "Each pays 30 euro." }]);
  });

  test("widgetSearch: both widgets search live; flights only when from and to are known; unknown tools get none", () => {
    expect(widgetSearch({ name: "show_flight_search", input: { date: "2026-11-24" } }, ctx)?.sreq).toBeNull();
    // The origin defaults to the venue's city (ctx.city), as in the composer; the form shows it.
    expect(widgetSearch({ name: "show_flight_search", input: { to: "Oslo" } }, ctx)?.sreq?.query).toBe("flights from Bremen to Oslo");
    expect(widgetSearch({ name: "show_flight_search", input: { to: "Oslo" } }, ctx)?.widget([]).ev.props).toEqual({ flights: [], from: "Bremen", to: "Oslo" });
    expect(widgetSearch({ name: "show_flight_search", input: { from: "Bremen", to: "New York" } }, ctx)?.sreq).toEqual({
      query: "flights from Bremen to New York",
      fields: ["carrier", "route", "price", "tags"],
      max: 4,
    });
    expect(widgetSearch({ name: "show_restaurants", input: {} }, ctx)?.sreq?.query).toBe("restaurants near Venue, Bremen");
    expect(widgetSearch({ name: "unknown_tool", input: {} }, ctx)).toBeNull();
    // A failed search still shows the widget, with no rows and nothing invented.
    expect(widgetSearch({ name: "show_flight_search", input: { from: "Bremen", to: "Oslo" } }, ctx)?.widget([])).toEqual({
      ev: { type: "widget", name: "FlightSearchWidget", props: { flights: [], from: "Bremen", to: "Oslo" } },
      rows: 0,
    });
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
