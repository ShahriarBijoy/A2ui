/**
 * One turn (PLAN §3.1): optional ROUTE (decision model) → patch or COMPOSE by mode, streamed to the
 * client as SSE. Pure orchestration: the router, the LLM and the clock come in as deps, so tests
 * run without network.
 */
import {
  A2UI_VERSION,
  isPathBinding,
  isPlainObject,
  messageSurfaceId,
  type A2uiMessage,
  type JsonObject,
  type JsonValue,
} from "@shared/a2ui";
import { CATALOG_PATH } from "@shared/catalog";
import { getAt } from "@shared/pointer";
import {
  LIMITS,
  MODES,
  type DataSource,
  type Knob,
  type RouteResult,
  type TurnEvent,
  type TurnRequest,
  type WidgetName,
} from "@shared/protocol";
import type Anthropic from "@anthropic-ai/sdk";
import {
  classifyLine,
  describeLlmError,
  FenceStripper,
  LineSplitter,
  type Llm,
  type LlmResult,
  type LlmUsage,
  type Prompt,
  type ToolCall,
} from "./claude";
import { resolveData, type DataDefaults } from "./data";
import { generateFlights, isIsoDate } from "./data/flights";
import { COMPOSER_RETRY_NOTE, composerPrompt, htmlPrompt, widgetsPrompt, type PromptContext } from "./prompts";
import { placeQuery, recordsToPlaces, restaurantProps, restaurantSearch } from "./restaurants";
import { parseSearchArgs, SEARCH_TIMEOUT_MS, type SearchOutcome, type SearchRequest } from "./search";

export type Emit = (ev: TurnEvent) => void | Promise<void>;

export type TurnDeps = {
  route: (req: TurnRequest, signal: AbortSignal) => Promise<RouteResult>;
  llm: Llm;
  context: PromptContext;
  now: () => number;
  composeTimeoutMs: number;
  /** Safety net around route(), which already enforces its own 800 ms budget. */
  routeGuardMs: number;
  /** Skipped and repaired composer lines are logged here (default console.warn, visible in wrangler tail). */
  warn?: (message: string) => void;
  /** Resolves "search" data lines (live web search). Without it such lines fail visibly: [] + fetch ok:false. */
  search?: (req: SearchRequest, signal: AbortSignal) => Promise<SearchOutcome>;
  /** Budget per live fetch (default SEARCH_TIMEOUT_MS). */
  fetchTimeoutMs?: number;
  /** Every live fetch ends this many ms after the turn started (default TURN_BUDGET_MS). */
  turnBudgetMs?: number;
};

/** The client gives up after 25 s (CLIENT_TIMEOUT_MS); fetches end before that so their [] and error still arrive. */
export const TURN_BUDGET_MS = 23_000;
/**
 * Each search costs ~15k input tokens plus a web search request. A prompt-injected "search 50 things"
 * must not fan out: lines over the cap get [] and a failed fetch event instead of a request.
 */
export const MAX_SEARCHES_PER_TURN = 3;

export const SSE_HEADERS: Record<string, string> = {
  "content-type": "text/event-stream",
  "cache-control": "no-cache, no-transform",
  "x-accel-buffering": "no",
};

/** One SSE event. JSON.stringify never emits a raw newline, so each event is a single data: line. */
export function encodeEvent(ev: TurnEvent): string {
  return `data: ${JSON.stringify(ev)}\n\n`;
}

/**
 * Streams the events of `run` as they happen. The client going away (request signal, or the
 * runtime cancelling the body) aborts `run` through its signal.
 */
export function sseResponse(run: (emit: Emit, signal: AbortSignal) => Promise<void>, clientSignal?: AbortSignal): Response {
  const ctl = new AbortController();
  const enc = new TextEncoder();
  let closed = false;
  if (clientSignal?.aborted) ctl.abort();
  clientSignal?.addEventListener("abort", () => ctl.abort(), { once: true });
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit: Emit = (ev) => {
        if (closed) return;
        try {
          controller.enqueue(enc.encode(encodeEvent(ev)));
        } catch {
          closed = true;
          ctl.abort();
        }
      };
      void run(emit, ctl.signal)
        .catch((err) => console.error("turn crashed", err))
        .finally(() => {
          if (closed) return;
          closed = true;
          try {
            controller.close();
          } catch {
            // already errored by the runtime
          }
        });
    },
    cancel() {
      closed = true;
      ctl.abort();
    },
  });
  return new Response(body, { headers: SSE_HEADERS });
}

// ── Request validation ────────────────────────────────────────────────────────

export type ParseResult = { ok: true; req: TurnRequest } | { ok: false; message: string };

const ROLES = new Set(["user", "agent", "tap"]);
const KNOB_TYPES = new Set(["choice", "multi", "bool"]);
const MAX_THREAD_TEXT = 600;

export function parseTurnRequest(body: unknown): ParseResult {
  const fail = (message: string): ParseResult => ({ ok: false, message });
  if (!isPlainObject(body)) return fail("body must be a JSON object");
  const { mode, decision, input, thread, surface, nextSurfaceId } = body;
  if (typeof mode !== "string" || !(MODES as readonly string[]).includes(mode)) return fail(`mode must be one of ${MODES.join(", ")}`);
  if (typeof decision !== "boolean") return fail("decision must be a boolean");
  if (typeof nextSurfaceId !== "string" || !nextSurfaceId.trim()) return fail("nextSurfaceId must be a non-empty string");

  if (!isPlainObject(input)) return fail("input must be an object");
  let parsedInput: TurnRequest["input"];
  if (input.type === "utterance") {
    if (typeof input.text !== "string") return fail("input.text must be a string");
    const text = input.text.trim();
    if (!text) return fail("utterance is empty");
    if (text.length > LIMITS.maxUtteranceChars) return fail(`utterance is longer than ${LIMITS.maxUtteranceChars} characters`);
    parsedInput = { type: "utterance", text };
  } else if (input.type === "action") {
    const a = input.action;
    if (
      !isPlainObject(a) ||
      typeof a.name !== "string" ||
      typeof a.surfaceId !== "string" ||
      typeof a.sourceComponentId !== "string" ||
      typeof a.timestamp !== "string" ||
      !isPlainObject(a.context)
    ) {
      return fail("input.action must have name, surfaceId, sourceComponentId, timestamp and context");
    }
    parsedInput = {
      type: "action",
      action: {
        name: a.name,
        surfaceId: a.surfaceId,
        sourceComponentId: a.sourceComponentId,
        timestamp: a.timestamp,
        context: a.context as JsonObject,
      },
    };
  } else {
    return fail('input.type must be "utterance" or "action"');
  }

  if (!Array.isArray(thread)) return fail("thread must be an array");
  const parsedThread: TurnRequest["thread"] = [];
  for (const t of thread.slice(-LIMITS.threadTurns)) {
    if (!isPlainObject(t) || typeof t.role !== "string" || !ROLES.has(t.role) || typeof t.text !== "string") {
      return fail("thread entries must be {role: user|agent|tap, text}");
    }
    parsedThread.push({ role: t.role as "user" | "agent" | "tap", text: t.text.slice(0, MAX_THREAD_TEXT) });
  }

  let parsedSurface: TurnRequest["surface"] = null;
  if (surface !== null && surface !== undefined) {
    if (!isPlainObject(surface) || typeof surface.id !== "string") return fail("surface must be null or {id, components, data, knobs}");
    const comps = surface.components;
    if (!Array.isArray(comps) || !comps.every((c) => isPlainObject(c) && typeof c.id === "string" && typeof c.component === "string")) {
      return fail("surface.components must be [{id, component}]");
    }
    const knobs = surface.knobs ?? [];
    if (
      !Array.isArray(knobs) ||
      !knobs.every((k) => isPlainObject(k) && typeof k.id === "string" && typeof k.path === "string" && typeof k.label === "string" && KNOB_TYPES.has(String(k.type)))
    ) {
      return fail("surface.knobs must be an array of knobs");
    }
    parsedSurface = {
      id: surface.id,
      components: comps.map((c) => ({ id: String(c.id), component: String(c.component) })),
      data: (surface.data ?? null) as JsonValue,
      knobs: knobs as Knob[],
    };
  }

  return {
    ok: true,
    req: { mode: mode as TurnRequest["mode"], decision, input: parsedInput, thread: parsedThread, surface: parsedSurface, nextSurfaceId },
  };
}

// ── The turn ──────────────────────────────────────────────────────────────────

class Aborted extends Error {}

/** Rejects as soon as `signal` aborts, even if `p` ignores the signal. */
function abortable<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Aborted());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Aborted());
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export function shouldRoute(req: TurnRequest): boolean {
  return req.mode === "a2ui" && req.decision && req.input.type === "utterance" && (req.surface?.knobs.length ?? 0) > 0;
}

/** Never throws; always ends with a done event, sent only after every live fetch has delivered. */
export async function runTurn(req: TurnRequest, deps: TurnDeps, emit: Emit, clientSignal?: AbortSignal): Promise<void> {
  const ctl = new AbortController();
  // Live fetches outlive the compose stream and its timeout; only the client going away stops them.
  const liveCtl = new AbortController();
  let reason: "client" | "timeout" | null = null;
  const onClientAbort = () => {
    reason ??= "client";
    ctl.abort();
    liveCtl.abort();
  };
  if (clientSignal?.aborted) onClientAbort();
  clientSignal?.addEventListener("abort", onClientAbort, { once: true });
  const send = async (ev: TurnEvent) => {
    try {
      await emit(ev);
    } catch (err) {
      console.error("emit failed", err);
    }
  };
  const live = new LiveFetches(liveCtl.signal, deps.now, deps.fetchTimeoutMs ?? SEARCH_TIMEOUT_MS, deps.now() + (deps.turnBudgetMs ?? TURN_BUDGET_MS));

  try {
    if (ctl.signal.aborted) return;
    if (shouldRoute(req)) {
      const r = await guardedRoute(req, deps, ctl.signal);
      await send({ type: "route", kind: r.kind, decision: r.decision, ms: r.ms, engine: r.engine, reason: r.reason, patches: r.patches.length });
      if (r.decision === "patch" && r.patches.length > 0 && req.surface) {
        for (const p of r.patches) {
          const msg: A2uiMessage = { version: A2UI_VERSION, updateDataModel: { surfaceId: req.surface.id, path: p.path, value: p.value } };
          await send({ type: "a2ui", msg, origin: "knob" });
        }
        await send({ type: "caption", text: patchCaption(r.patches, req.surface.knobs) });
        return;
      }
    }

    const timer = setTimeout(() => {
      reason ??= "timeout";
      ctl.abort();
    }, deps.composeTimeoutMs);
    try {
      if (req.mode === "a2ui") await composeA2ui(req, deps, send, ctl.signal, live);
      else if (req.mode === "widgets") await composeWidgets(req, deps, send, ctl.signal, live);
      else await composeHtml(req, deps, send, ctl.signal);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (reason === "timeout") await send({ type: "error", message: "The composer took too long" });
    else if (reason !== "client") await send({ type: "error", message: describeLlmError(err) });
  } finally {
    // The client keeps skeletons for pending lists until done, so done waits for the data.
    await live.settle();
    clientSignal?.removeEventListener("abort", onClientAbort);
    await send({ type: "done" });
  }
}

type FetchSettled = { outcome: SearchOutcome; ms: number };

/**
 * The live data requests of one turn. Each runs beside the compose stream with its own budget
 * (min(per-fetch timeout, what is left of the turn budget)) and never rejects: a failure or timeout
 * is delivered as an outcome. settle() resolves when all have delivered or the client went away.
 */
class LiveFetches {
  private readonly pending = new Map<string, Promise<void>>();

  constructor(
    private readonly signal: AbortSignal,
    private readonly now: () => number,
    private readonly timeoutMs: number,
    private readonly deadlineAt: number,
  ) {}

  has(key: string): boolean {
    return this.pending.has(key);
  }

  /** Fetches started this turn (a reused fetch counts once). */
  get size(): number {
    return this.pending.size;
  }

  /** The client went away: no fetch delivers any more. */
  get cancelled(): boolean {
    return this.signal.aborted;
  }

  start(key: string, run: (signal: AbortSignal) => Promise<SearchOutcome>, deliver: (r: FetchSettled) => Promise<void>): void {
    const t0 = this.now();
    const budget = Math.max(0, Math.min(this.timeoutMs, this.deadlineAt - t0));
    const outer = this.signal;
    const ctl = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = () => {};
    // Rejects nothing: resolves with a failure on timeout or when the client goes away.
    const stop = new Promise<SearchOutcome>((resolve) => {
      onAbort = () => resolve({ ok: false, error: "cancelled" });
      if (outer.aborted) return onAbort();
      outer.addEventListener("abort", onAbort, { once: true });
      timer = setTimeout(() => resolve({ ok: false, error: `timed out after ${Math.round(budget)} ms` }), budget);
    });
    const work = Promise.resolve()
      .then(() => run(ctl.signal))
      .catch((err): SearchOutcome => ({ ok: false, error: describeLlmError(err, "Fetch failed") }));
    const done = Promise.race([work, stop])
      .then(async (outcome) => {
        clearTimeout(timer);
        outer.removeEventListener("abort", onAbort);
        // Ends a request that lost the race against the timeout; a no-op after an answer.
        ctl.abort();
        if (!outer.aborted) await deliver({ outcome, ms: Math.round(this.now() - t0) });
      })
      .catch((err) => console.error("live fetch delivery failed", err));
    this.pending.set(key, done);
  }

  async settle(): Promise<void> {
    await Promise.all(this.pending.values());
  }
}

async function guardedRoute(req: TurnRequest, deps: TurnDeps, signal: AbortSignal): Promise<RouteResult> {
  const t0 = deps.now();
  const fallback = (why: string): RouteResult => ({
    kind: "new",
    kindConfidence: 0,
    decision: "compose",
    patches: [],
    ms: Math.round(deps.now() - t0),
    engine: "router",
    reason: why,
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const guard = new Promise<RouteResult>((resolve) => {
      timer = setTimeout(() => resolve(fallback(`router guard timeout (>${deps.routeGuardMs} ms)`)), deps.routeGuardMs);
    });
    return await Promise.race([deps.route(req, signal), guard]);
  } catch (err) {
    return fallback(`router threw: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/** "Guests 6 · Time 20:00", written by code from the knob labels (no LLM on this path). */
export function patchCaption(patches: RouteResult["patches"], knobs: Knob[]): string {
  const parts = patches.map((p) => {
    const knob = knobs.find((k) => k.id === p.knobId) ?? knobs.find((k) => k.path === p.path);
    const label = knob?.label ?? p.path.split("/").filter(Boolean).pop() ?? p.path;
    return `${label} ${valueLabel(p.value, knob)}`;
  });
  return parts.join(" · ");
}

function valueLabel(value: JsonValue, knob: Knob | undefined): string {
  if (knob && knob.type !== "bool") {
    const opt = knob.options.find((o) => JSON.stringify(o.value) === JSON.stringify(value));
    if (opt) return opt.key;
  }
  if (typeof value === "boolean") return value ? "on" : "off";
  if (Array.isArray(value)) return value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ");
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

function dataDefaults(ctx: PromptContext): DataDefaults {
  return { from: ctx.city, date: ctx.tomorrow };
}

/** Why the model stopped, as a short error line, when the stop is a failure. */
function stopProblem(stopReason: string | null, producedUi: boolean): string | null {
  if (stopReason === "refusal") return "Claude declined this request";
  if (stopReason === "max_tokens" && !producedUi) return "The composer ran out of tokens before showing anything";
  return null;
}

async function composeA2ui(req: TurnRequest, deps: TurnDeps, send: Emit, signal: AbortSignal, live: LiveFetches): Promise<void> {
  const prompt = composerPrompt(req, deps.context);
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const t0 = deps.now();
  let firstUi: number | null = null;
  let skipped = 0;
  let repaired = 0;
  let createdSurface: string | null = null;
  /** An attempt is streaming, so a createSurface may still come for data that has nowhere to go yet. */
  let holding = false;
  /**
   * Data resolved before this turn's createSurface. The model sometimes writes the data line first;
   * sent at once it would land on the old surface (and createSurface resets the new one), so it waits
   * for the next A2UI message and goes to that message's surface. `after` is its fetch event.
   */
  let pending: { into: string; records: JsonValue; after: TurnEvent; ui: boolean }[] = [];
  /** The caption is held until the attempt ends: it is sent once, and only if a screen exists. */
  let caption: string | null = null;

  /** `ui: false` for live search results: they arrive seconds later and are not the first UI. */
  const emitA2ui = async (msg: A2uiMessage, origin: "llm" | "data", ui = true) => {
    if (ui) firstUi ??= Math.round(deps.now() - t0);
    await send({ type: "a2ui", msg, origin });
  };
  const dataMsg = (surfaceId: string, into: string, records: JsonValue): A2uiMessage => ({
    version: A2UI_VERSION,
    updateDataModel: { surfaceId, path: into, value: records },
  });
  const flushPending = async (surfaceId: string) => {
    const held = pending;
    pending = [];
    for (const p of held) {
      await emitA2ui(dataMsg(surfaceId, p.into, p.records), "data", p.ui);
      await send(p.after);
    }
  };
  const fallbackSurface = () => createdSurface ?? req.surface?.id ?? req.nextSurfaceId;
  /** Nothing shown and nothing about to be: held demo data is a screen once flushed, a held search result is not. */
  const noScreen = () => firstUi === null && !pending.some((p) => p.ui);
  /** Resolved data goes to this turn's new surface, waits for it while the model still writes, else the fallback. */
  const deliver = async (into: string, records: JsonValue, after: TurnEvent, ui: boolean) => {
    if (!createdSurface && holding) {
      pending.push({ into, records, after, ui });
      return;
    }
    await emitA2ui(dataMsg(createdSurface ?? fallbackSurface(), into, records), "data", ui);
    await send(after);
  };
  const skip = (reason: string, line: string) => {
    skipped++;
    warn(`composer line skipped (${reason}): ${line.slice(0, 160)}`);
  };

  const handle = async (line: string, opts: { repair?: boolean } = {}) => {
    const c = classifyLine(line, opts);
    if (c.kind === "ignore") return;
    if (c.kind === "invalid") return skip(c.reason, line);
    if (c.repaired) {
      repaired++;
      warn(`composer line repaired (closing brackets): ${line.slice(0, 160)}`);
    }
    if (c.kind === "caption") {
      // With no screen yet a retry may follow; held data then waits for the retry's surface (streamOnce).
      if (!noScreen()) await flushPending(fallbackSurface());
      caption = c.text;
      return;
    }
    if (c.kind === "a2ui") {
      const checks = fixChecks(fixCatalogId(c.msg, deps.context.catalogId));
      if (checks.fixed > 0) warn(`composer @checks fixed (${checks.fixed} bare condition): ${line.slice(0, 160)}`);
      const msg = checks.msg;
      if ("createSurface" in msg) {
        createdSurface = msg.createSurface.surfaceId;
        await emitA2ui(msg, "llm");
        await flushPending(createdSurface);
      } else {
        await flushPending(messageSurfaceId(msg));
        await emitA2ui(msg, "llm");
      }
      return;
    }
    const into = c.into;
    const args = resolveArgBindings(c.args, req.surface?.data ?? null);
    if (c.source === "search") {
      const parsed = parseSearchArgs(args);
      if (!parsed.ok) return skip(parsed.error, line);
      const key = `search ${into} ${JSON.stringify(parsed.req)}`;
      // A retry that repeats the line reuses the search already running.
      if (live.has(key)) return;
      const search = deps.search;
      const sreq = parsed.req;
      if (live.size >= MAX_SEARCHES_PER_TURN) {
        warn(`search not started (more than ${MAX_SEARCHES_PER_TURN} in one turn): ${sreq.query}`);
        // [] turns the skeleton into "Nothing found" instead of shimmering until done.
        await deliver(into, [], { type: "fetch", source: "search", query: sreq.query, ok: false, records: 0, ms: 0, error: "too many searches" }, false);
        return;
      }
      // Not awaited: the search runs beside the compose stream; done waits for it (runTurn).
      live.start(
        key,
        (sig) => (search ? search(sreq, sig) : Promise.resolve<SearchOutcome>({ ok: false, error: "live search is not configured" })),
        async ({ outcome, ms }) => {
          if (!outcome.ok) warn(`search failed (${outcome.error}): ${sreq.query}`);
          else if (outcome.dropped > 0) warn(`search dropped ${outcome.dropped} invalid item(s): ${sreq.query}`);
          await deliver(into, outcome.ok ? outcome.records : [], fetchEvent("search", sreq.query, outcome, ms), false);
        },
      );
      return;
    }
    const tData = deps.now();
    const res = resolveData({ source: c.source, args }, dataDefaults(deps.context));
    if (!res.ok) return skip(res.error, line);
    const after: TurnEvent = { type: "fetch", source: res.source, query: res.query, ok: true, records: res.records.length, ms: Math.round(deps.now() - tData) };
    await deliver(into, res.records, after, true);
  };

  // Without thinking the composer occasionally answers a tap with a caption only (measured ~1 in 10
  // confirm taps). One retry costs ~1.5 s; an unchanged screen on stage costs more. A refusal or a
  // max_tokens stop would only repeat, so those are not retried.
  const retryable = (r: LlmResult) => noScreen() && r.stopReason !== "refusal" && r.stopReason !== "max_tokens";

  const streamOnce = async (p: Prompt, mayRetry: boolean): Promise<LlmResult> => {
    const stream = deps.llm.streamText(p, signal);
    const splitter = new LineSplitter();
    const it = stream[Symbol.asyncIterator]();
    holding = true;
    try {
      for (;;) {
        const r = await abortable(it.next(), signal);
        if (r.done) break;
        for (const line of splitter.push(r.value)) await handle(line);
      }
      const result = await abortable(stream.result(), signal);
      // After a max_tokens stop the unterminated last line is cut off: it must parse as written.
      const cutOff = result.stopReason === "max_tokens";
      for (const line of splitter.flush()) await handle(line, { repair: !cutOff });
      // When a retry follows, data still waiting for a surface (and a reused search that has not
      // answered yet) keeps waiting for the retry's createSurface: on the old surface the retry's List
      // would never fill.
      if (!(mayRetry && retryable(result))) {
        holding = false;
        await flushPending(fallbackSurface());
      }
      if (firstUi !== null && caption !== null) await send({ type: "caption", text: caption });
      caption = null;
      return result;
    } catch (err) {
      stream.abort();
      holding = false;
      // Held data still reaches the client with its fetch event before the error.
      await flushPending(fallbackSurface());
      throw err;
    }
  };

  const first = await streamOnce(prompt, true);
  let usage = first.usage;
  let stopReason = first.stopReason;
  if (retryable(first)) {
    const retry = await streamOnce({ ...prompt, user: `${prompt.user}\n${COMPOSER_RETRY_NOTE}` }, false);
    usage = addUsage(usage, retry.usage);
    stopReason = retry.stopReason;
  }
  // Built as a variable so it can carry repaired_lines before the shared type lists it.
  const usageEvent = {
    type: "usage" as const,
    ...usage,
    first_ui_ms: firstUi,
    compose_ms: Math.round(deps.now() - t0),
    skipped_lines: skipped,
    repaired_lines: repaired,
  };
  await send(usageEvent);
  const problem = stopProblem(stopReason, firstUi !== null);
  // Still no screen: an error gives the speaker "Try again" (U15).
  if (problem) await send({ type: "error", message: problem });
  else if (firstUi === null) await send({ type: "error", message: "The composer returned no screen" });
}

/** The fetch event for one live data line: measured values only (no tokens if the call never answered). */
function fetchEvent(source: DataSource, query: string, outcome: SearchOutcome, ms: number): Extract<TurnEvent, { type: "fetch" }> {
  const ev: Extract<TurnEvent, { type: "fetch" }> = { type: "fetch", source, query, ok: outcome.ok, records: outcome.ok ? outcome.records.length : 0, ms };
  if (outcome.searches !== undefined) ev.searches = outcome.searches;
  if (outcome.inputTokens !== undefined) ev.input_tokens = outcome.inputTokens;
  if (outcome.outputTokens !== undefined) ev.output_tokens = outcome.outputTokens;
  if (!outcome.ok) ev.error = outcome.error;
  return ev;
}

function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    model: b.model,
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_tokens: a.cache_read_tokens + b.cache_read_tokens,
    cache_write_tokens: a.cache_write_tokens + b.cache_write_tokens,
  };
}

/** The client rejects a createSurface whose catalogId does not end with the catalog path; fix a mangled id. */
function fixCatalogId(msg: A2uiMessage, catalogId: string): A2uiMessage {
  if (!("createSurface" in msg) || msg.createSurface.catalogId?.endsWith?.(CATALOG_PATH)) return msg;
  return { version: A2UI_VERSION, createSurface: { ...msg.createSurface, catalogId } };
}

/**
 * Without thinking the composer sometimes writes a second check as {"@call",...,"message"} without its
 * "condition" wrapper (2 of 18 live flight forms); the client then refuses the whole Button. Wrap it.
 */
export function fixChecks(msg: A2uiMessage): { msg: A2uiMessage; fixed: number } {
  if (!("updateComponents" in msg)) return { msg, fixed: 0 };
  let fixed = 0;
  const components = msg.updateComponents.components.map((comp) => {
    const checks = comp["@checks"];
    if (!Array.isArray(checks)) return comp;
    let changed = false;
    const next = checks.map((k: unknown) => {
      if (!isPlainObject(k) || "condition" in k || typeof k["@call"] !== "string") return k;
      const { message, ...call } = k;
      changed = true;
      fixed++;
      return { condition: call, message };
    });
    return changed ? { ...comp, "@checks": next } : comp;
  });
  if (fixed === 0) return { msg, fixed };
  return { msg: { version: A2UI_VERSION, updateComponents: { ...msg.updateComponents, components } }, fixed };
}

/** Data args should be literals; an absolute {"@path"} is read from the current surface's data. */
function resolveArgBindings(args: JsonObject, data: JsonValue): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of Object.entries(args)) {
    if (isPathBinding(v) && v["@path"].startsWith("/")) {
      const got = getAt(data, v["@path"]);
      if (got !== undefined) out[k] = Array.isArray(got) && got.length === 1 ? got[0] : got;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ── widgets mode ──────────────────────────────────────────────────────────────

export const WIDGET_TOOLS: Anthropic.Tool[] = [
  {
    name: "show_restaurants",
    description: "Show the restaurant widget: a list of restaurants near the venue, optionally filtered.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", description: "Cuisine or kind of place, e.g. italian, vegan, pub" },
        max_walk_min: { type: "number", description: "Maximum walking time in minutes" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "show_flight_search",
    description: "Show the flight search widget, prefilled with what the person said.",
    input_schema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Departure city" },
        to: { type: "string", description: "Destination city" },
        date: { type: "string", description: "Departure date, YYYY-MM-DD" },
      },
      additionalProperties: false,
    },
  },
];

/** The widget a tool call shows at once: the flight search (demo flights). show_restaurants searches first (composeWidgets). */
export function widgetEvent(tool: ToolCall, defaults: DataDefaults): Extract<TurnEvent, { type: "widget" }> | null {
  const input = tool.input;
  if (tool.name === "show_flight_search") {
    const from = typeof input.from === "string" && input.from.trim() ? input.from.trim() : undefined;
    const to = typeof input.to === "string" && input.to.trim() ? input.to.trim() : undefined;
    const date = typeof input.date === "string" && isIsoDate(input.date) ? input.date : undefined;
    const props: JsonObject = { flights: from && to ? generateFlights(from, to, date ?? defaults.date) : [] };
    if (from) props.from = from;
    if (to) props.to = to;
    if (date) props.date = date;
    return { type: "widget", name: "FlightSearchWidget" satisfies WidgetName, props };
  }
  return null;
}

async function composeWidgets(req: TurnRequest, deps: TurnDeps, send: Emit, signal: AbortSignal, live: LiveFetches): Promise<void> {
  const t0 = deps.now();
  const reply = await abortable(deps.llm.callTools(widgetsPrompt(req, deps.context), WIDGET_TOOLS, signal), signal);
  const ms = Math.round(deps.now() - t0);
  // A tool input cut off by max_tokens can still look valid: never render it.
  const tool = reply.stopReason === "max_tokens" || reply.stopReason === "refusal" ? null : reply.tool;
  const text = reply.stopReason === "refusal" ? "" : reply.text;
  let firstUi: number | null = null;
  const show = async (ev: TurnEvent) => {
    firstUi ??= Math.round(deps.now() - t0);
    await send(ev);
  };
  if (tool?.name === "show_restaurants") {
    startRestaurantSearch(tool.input, deps, send, show, live);
    // The widget is not streamed: it shows once the search has answered (or failed, with no places).
    await live.settle();
    if (live.cancelled) return;
  } else {
    const widget = tool ? widgetEvent(tool, dataDefaults(deps.context)) : null;
    if (widget) await show(widget);
    else if (text) await show({ type: "text", delta: text });
  }
  // compose_ms is the tool call; first_ui_ms includes the restaurant search, since the widget waits for it.
  const usageEvent = {
    type: "usage" as const,
    ...reply.usage,
    first_ui_ms: firstUi,
    compose_ms: ms,
    skipped_lines: 0,
    repaired_lines: 0,
  };
  await send(usageEvent);
  const problem = stopProblem(reply.stopReason, firstUi !== null);
  if (problem) await send({ type: "error", message: problem });
}

/**
 * show_restaurants: the same live search as a2ui data lines, with the same budget (LiveFetches) and
 * validation (runSearch). Then the widget (no places on failure), then its measured fetch event.
 */
function startRestaurantSearch(input: JsonObject, deps: TurnDeps, send: Emit, show: Emit, live: LiveFetches): void {
  const warn = deps.warn ?? ((m: string) => console.warn(m));
  const q = placeQuery(input);
  const sreq = restaurantSearch(q, deps.context);
  const search = deps.search;
  live.start(
    "restaurants",
    (sig) => (search ? search(sreq, sig) : Promise.resolve<SearchOutcome>({ ok: false, error: "live search is not configured" })),
    async ({ outcome, ms }) => {
      if (!outcome.ok) warn(`restaurant search failed (${outcome.error}): ${sreq.query}`);
      else if (outcome.dropped > 0) warn(`restaurant search dropped ${outcome.dropped} invalid item(s): ${sreq.query}`);
      const places = outcome.ok ? recordsToPlaces(outcome.records, q.max_walk_min) : [];
      await show({ type: "widget", name: "RestaurantWidget" satisfies WidgetName, props: restaurantProps(places, q) });
      // records counts the rows the widget shows, so the chip and the list agree.
      await send({ ...fetchEvent("search", sreq.query, outcome, ms), records: places.length });
    },
  );
}

// ── html mode ─────────────────────────────────────────────────────────────────

async function composeHtml(req: TurnRequest, deps: TurnDeps, send: Emit, signal: AbortSignal): Promise<void> {
  const t0 = deps.now();
  const stream = deps.llm.streamText(htmlPrompt(req), signal);
  const fence = new FenceStripper();
  let firstUi: number | null = null;
  const forward = async (text: string) => {
    if (!text) return;
    firstUi ??= Math.round(deps.now() - t0);
    await send({ type: "html", delta: text });
  };
  const it = stream[Symbol.asyncIterator]();
  try {
    for (;;) {
      const r = await abortable(it.next(), signal);
      if (r.done) break;
      await forward(fence.push(r.value));
    }
    await forward(fence.end());
    const { usage, stopReason } = await abortable(stream.result(), signal);
    const usageEvent = {
      type: "usage" as const,
      ...usage,
      first_ui_ms: firstUi,
      compose_ms: Math.round(deps.now() - t0),
      skipped_lines: 0,
      repaired_lines: 0,
    };
    await send(usageEvent);
    const problem = stopProblem(stopReason, firstUi !== null);
    if (problem) await send({ type: "error", message: problem });
  } catch (err) {
    stream.abort();
    throw err;
  }
}
