/**
 * Turn stream client: POST /api/turn, read the SSE stream, feed every event to
 * store.applyTurnEvent (the single ingress). One turn in flight at a time.
 * createTurnClient takes its store, fetch and timers as arguments so tests can drive it.
 */
import type { A2uiAction, JsonValue } from "@shared/a2ui";
import { isPlainObject } from "@shared/a2ui";
import type { TurnEvent, TurnInput, TurnRequest } from "@shared/protocol";
import { apiFetch } from "@/apiBase";
import type { AgentItem, StoreApi } from "@/state";
import { store } from "@/store";

/** Above the Worker's 20 s compose timeout, so the server normally reports first. */
export const CLIENT_TIMEOUT_MS = 25_000;

export type SendTurnOptions = { input: TurnInput; display: string; via: "voice" | "text" | "tap" };

export type TurnClientDeps = {
  store: StoreApi;
  fetch: (path: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export type TurnClient = {
  /** Resolves when the stream has ended for any reason (done, error, abort, timeout). */
  sendTurn(opts: SendTurnOptions): Promise<void>;
  sendAction(action: A2uiAction): Promise<void>;
  retryTurn(agentItemId: string): Promise<void>;
  abortTurn(): void;
};

// ── SSE parsing (pure) ───────────────────────────────────────────────────────

/** CRLF and CR become LF. A trailing CR may be half of a CRLF split across chunks, so it waits for more input. */
function normalizeNewlines(s: string, final: boolean): string {
  const out = s.replace(/\r\n/g, "\n");
  return final ? out.replace(/\r/g, "\n") : out.replace(/\r(?=[\s\S])/g, "\n");
}

/** Data of one event block: its "data:" lines joined with LF, or null when it has none. */
function dataOf(block: string): string | null {
  const lines = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  return lines.length === 0 ? null : lines.join("\n");
}

/** Incremental SSE parser: feed decoded text in any chunking, get the data of each complete event. */
export function createSseParser(): { push(text: string): string[]; end(): string[] } {
  let buffer = "";
  const take = (final: boolean): string[] => {
    buffer = normalizeNewlines(buffer, final);
    const out: string[] = [];
    let sep = buffer.indexOf("\n\n");
    while (sep >= 0) {
      const data = dataOf(buffer.slice(0, sep));
      if (data !== null) out.push(data);
      buffer = buffer.slice(sep + 2);
      sep = buffer.indexOf("\n\n");
    }
    if (final) {
      // The last event may end without its blank line.
      const data = buffer.trim() === "" ? null : dataOf(buffer);
      if (data !== null) out.push(data);
      buffer = "";
    }
    return out;
  };
  return {
    push: (text) => {
      buffer += text;
      return take(false);
    },
    end: () => take(true),
  };
}

/** One event payload, or null (logged) when it is not a JSON object with a string "type". */
export function parseTurnEvent(payload: string): TurnEvent | null {
  let ev: unknown;
  try {
    ev = JSON.parse(payload);
  } catch (err) {
    console.warn("[turns] skipping an SSE event that is not JSON", shorten(payload, 200), err);
    return null;
  }
  if (!isPlainObject(ev) || typeof ev.type !== "string") {
    console.warn("[turns] skipping an SSE event without a type", shorten(payload, 200));
    return null;
  }
  return ev as TurnEvent;
}

// ── Client ───────────────────────────────────────────────────────────────────

type Flight = {
  turnId: string;
  controller: AbortController;
  timer: unknown;
  /** Set exactly once; afterwards the aborted fetch's rejection and late chunks are ignored. */
  ended: boolean;
};

export function createTurnClient(deps: TurnClientDeps): TurnClient {
  const { store: st } = deps;
  const timeoutMs = deps.timeoutMs ?? CLIENT_TIMEOUT_MS;
  const setTimer = deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let inflight: Flight | null = null;

  const end = (flight: Flight, failMessage: string | null): void => {
    if (flight.ended) return;
    flight.ended = true;
    clearTimer(flight.timer);
    if (inflight === flight) inflight = null;
    flight.controller.abort();
    if (failMessage !== null) st.failTurn(flight.turnId, failMessage);
  };

  /** Applies one payload; true when it was the "done" event. */
  const deliver = (turnId: string, payload: string): boolean => {
    const ev = parseTurnEvent(payload);
    if (!ev) return false;
    st.applyTurnEvent(turnId, ev);
    return ev.type === "done";
  };

  const stream = async (flight: Flight, body: TurnRequest): Promise<void> => {
    try {
      const res = await deps.fetch("/api/turn", {
        method: "POST",
        body: JSON.stringify(body),
        signal: flight.controller.signal,
      });
      if (flight.ended) return;
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        end(flight, "HTTP " + res.status + ": " + shorten(text.trim() || res.statusText));
        return;
      }
      if (!res.body) {
        end(flight, "Empty response");
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      const parser = createSseParser();
      for (;;) {
        const { value, done } = await reader.read();
        if (flight.ended) return;
        const payloads = done
          ? [...parser.push(decoder.decode()), ...parser.end()]
          : parser.push(decoder.decode(value, { stream: true }));
        for (const payload of payloads) {
          if (deliver(flight.turnId, payload)) {
            end(flight, null);
            return;
          }
          if (flight.ended) return;
        }
        if (done) break;
      }
      end(flight, "Connection closed");
    } catch (err) {
      if (flight.ended) return;
      end(flight, "Network error: " + (err instanceof Error ? err.message : String(err)));
    }
  };

  const abortTurn = (): void => {
    const flight = inflight;
    if (!flight) return;
    end(flight, null);
    const item = st.getState().thread.find((i): i is AgentItem => i.kind === "agent" && i.turnId === flight.turnId);
    // Superseded, not failed: the item ends quietly as done (recorded, so replay ends there too).
    if (item && (item.status === "pending" || item.status === "streaming")) {
      st.applyTurnEvent(flight.turnId, { type: "done" });
    }
  };

  const sendTurn = (opts: SendTurnOptions): Promise<void> => {
    abortTurn();
    // Build the request before beginTurn so the new user line is not part of "thread".
    const body = st.buildTurnRequest(opts.input);
    // U2: the user line and the skeleton appear before any network.
    const turnId = st.beginTurn({ input: opts.input, display: opts.display, via: opts.via });
    const flight: Flight = { turnId, controller: new AbortController(), timer: undefined, ended: false };
    flight.timer = setTimer(() => end(flight, "Timed out"), timeoutMs);
    inflight = flight;
    return stream(flight, body);
  };

  return {
    sendTurn,
    sendAction: (action) => {
      const summary = summarizeContext(action.context);
      return sendTurn({
        input: { type: "action", action },
        display: summary ? action.name + " · " + summary : action.name,
        via: "tap",
      });
    },
    retryTurn: (agentItemId) => {
      const item = st.getState().thread.find((i): i is AgentItem => i.kind === "agent" && i.id === agentItemId);
      if (!item) {
        console.warn("[turns] retryTurn: no agent item", agentItemId);
        return Promise.resolve();
      }
      return sendTurn(item.retry);
    },
    abortTurn,
  };
}

const client = createTurnClient({ store, fetch: apiFetch });

export function sendTurn(opts: SendTurnOptions): void {
  void client.sendTurn(opts);
}

export function sendAction(action: A2uiAction): void {
  void client.sendAction(action);
}

export function retryTurn(agentItemId: string): void {
  void client.retryTurn(agentItemId);
}

/** Stops the in-flight turn quietly: its agent item ends as "done", not as an error. */
export function abortTurn(): void {
  client.abortTurn();
}

function shorten(s: string, max = 120): string {
  const one = s.replace(/\s+/g, " ");
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

function summarizeContext(context: { [key: string]: JsonValue }): string {
  const parts = Object.values(context)
    .map((v) => {
      if (v === null) return "";
      if (Array.isArray(v)) return v.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))).join("/");
      if (typeof v === "object") return JSON.stringify(v);
      return String(v);
    })
    .filter((p) => p !== "");
  return shorten(parts.join(", "), 60);
}
