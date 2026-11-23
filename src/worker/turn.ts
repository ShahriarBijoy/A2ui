/**
 * One turn (PLAN §3.1): optional ROUTE (decision model) → patch or COMPOSE by mode, streamed to the
 * client as SSE. Pure orchestration: the router, the LLM and the clock come in as deps, so tests
 * run without network.
 */
import {
  A2UI_VERSION,
  isPathBinding,
  isPlainObject,
  type A2uiMessage,
  type JsonObject,
  type JsonValue,
} from "@shared/a2ui";
import { CATALOG_PATH } from "@shared/catalog";
import { getAt } from "@shared/pointer";
import {
  LIMITS,
  MODES,
  type Knob,
  type RouteResult,
  type TurnEvent,
  type TurnRequest,
  type WidgetName,
} from "@shared/protocol";
import type Anthropic from "@anthropic-ai/sdk";
import { classifyLine, describeLlmError, FenceStripper, LineSplitter, type Llm, type ToolCall } from "./claude";
import { findPlaces, placeQuery, resolveData, type DataDefaults } from "./data";
import { generateFlights, isIsoDate } from "./data/flights";
import { composerPrompt, htmlPrompt, widgetsPrompt, type PromptContext } from "./prompts";

export type Emit = (ev: TurnEvent) => void | Promise<void>;

export type TurnDeps = {
  route: (req: TurnRequest, signal: AbortSignal) => Promise<RouteResult>;
  llm: Llm;
  context: PromptContext;
  now: () => number;
  composeTimeoutMs: number;
  /** Safety net around route(), which already enforces its own 800 ms budget. */
  routeGuardMs: number;
};

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

/** Never throws; always ends with a done event. */
export async function runTurn(req: TurnRequest, deps: TurnDeps, emit: Emit, clientSignal?: AbortSignal): Promise<void> {
  const ctl = new AbortController();
  let reason: "client" | "timeout" | null = null;
  const onClientAbort = () => {
    reason ??= "client";
    ctl.abort();
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
      if (req.mode === "a2ui") await composeA2ui(req, deps, send, ctl.signal);
      else if (req.mode === "widgets") await composeWidgets(req, deps, send, ctl.signal);
      else await composeHtml(req, deps, send, ctl.signal);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (reason === "timeout") await send({ type: "error", message: "The composer took too long" });
    else if (reason !== "client") await send({ type: "error", message: describeLlmError(err) });
  } finally {
    clientSignal?.removeEventListener("abort", onClientAbort);
    await send({ type: "done" });
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

async function composeA2ui(req: TurnRequest, deps: TurnDeps, send: Emit, signal: AbortSignal): Promise<void> {
  const prompt = composerPrompt(req, deps.context);
  const t0 = deps.now();
  const stream = deps.llm.streamText(prompt, signal);
  const splitter = new LineSplitter();
  let firstUi: number | null = null;
  let skipped = 0;
  let createdSurface: string | null = null;

  const handle = async (line: string) => {
    const c = classifyLine(line);
    if (c.kind === "ignore") return;
    if (c.kind === "invalid") {
      skipped++;
      return;
    }
    if (c.kind === "caption") {
      await send({ type: "caption", text: c.text });
      return;
    }
    let msg: A2uiMessage;
    let origin: "llm" | "data";
    if (c.kind === "a2ui") {
      msg = fixCatalogId(c.msg, deps.context.catalogId);
      if ("createSurface" in msg) createdSurface = msg.createSurface.surfaceId;
      origin = "llm";
    } else {
      const args = resolveArgBindings(c.args, req.surface?.data ?? null);
      const res = resolveData({ source: c.source, args }, dataDefaults(deps.context));
      if (!res.ok) {
        skipped++;
        return;
      }
      const surfaceId = createdSurface ?? req.surface?.id ?? req.nextSurfaceId;
      msg = { version: A2UI_VERSION, updateDataModel: { surfaceId, path: c.into, value: res.records } };
      origin = "data";
    }
    firstUi ??= Math.round(deps.now() - t0);
    await send({ type: "a2ui", msg, origin });
  };

  const it = stream[Symbol.asyncIterator]();
  try {
    for (;;) {
      const r = await abortable(it.next(), signal);
      if (r.done) break;
      for (const line of splitter.push(r.value)) await handle(line);
    }
    for (const line of splitter.flush()) await handle(line);
    const usage = await abortable(stream.usage(), signal);
    await send({
      type: "usage",
      ...usage,
      first_ui_ms: firstUi,
      compose_ms: Math.round(deps.now() - t0),
      skipped_lines: skipped,
    });
  } catch (err) {
    stream.abort();
    throw err;
  }
}

/** The client rejects a createSurface whose catalogId does not end with the catalog path; fix a mangled id. */
function fixCatalogId(msg: A2uiMessage, catalogId: string): A2uiMessage {
  if (!("createSurface" in msg) || msg.createSurface.catalogId?.endsWith?.(CATALOG_PATH)) return msg;
  return { version: A2UI_VERSION, createSurface: { ...msg.createSurface, catalogId } };
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

export function widgetEvent(tool: ToolCall, defaults: DataDefaults): Extract<TurnEvent, { type: "widget" }> | null {
  const input = tool.input;
  if (tool.name === "show_restaurants") {
    const q = placeQuery(input);
    const props: JsonObject = { places: findPlaces(q) };
    if (q.kind) props.kind = q.kind;
    if (q.max_walk_min !== undefined) props.max_walk_min = q.max_walk_min;
    return { type: "widget", name: "RestaurantWidget" satisfies WidgetName, props };
  }
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

async function composeWidgets(req: TurnRequest, deps: TurnDeps, send: Emit, signal: AbortSignal): Promise<void> {
  const t0 = deps.now();
  const reply = await abortable(deps.llm.callTools(widgetsPrompt(req, deps.context), WIDGET_TOOLS, signal), signal);
  const ms = Math.round(deps.now() - t0);
  const widget = reply.tool ? widgetEvent(reply.tool, dataDefaults(deps.context)) : null;
  if (widget) await send(widget);
  else if (reply.text) await send({ type: "text", delta: reply.text });
  await send({ type: "usage", ...reply.usage, first_ui_ms: widget || reply.text ? ms : null, compose_ms: ms, skipped_lines: 0 });
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
    const usage = await abortable(stream.usage(), signal);
    await send({ type: "usage", ...usage, first_ui_ms: firstUi, compose_ms: Math.round(deps.now() - t0), skipped_lines: 0 });
  } catch (err) {
    stream.abort();
    throw err;
  }
}
