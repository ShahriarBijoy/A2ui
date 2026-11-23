/**
 * Turn stream client: POST /api/turn, read the SSE stream, feed every event to
 * store.applyTurnEvent (the single ingress). One turn in flight at a time.
 */
import type { A2uiAction, JsonValue } from "@shared/a2ui";
import { isPlainObject } from "@shared/a2ui";
import type { TurnEvent, TurnInput, TurnRequest } from "@shared/protocol";
import { apiFetch } from "@/apiBase";
import type { AgentItem } from "@/state";
import { store } from "@/store";

/** Above the Worker's 20 s compose timeout, so the server normally reports first. */
const CLIENT_TIMEOUT_MS = 25_000;

type Flight = {
  turnId: string;
  controller: AbortController;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Set exactly once; afterwards the aborted fetch's rejection and late chunks are ignored. */
  ended: boolean;
};

let inflight: Flight | null = null;

function end(flight: Flight, failMessage: string | null): void {
  if (flight.ended) return;
  flight.ended = true;
  clearTimeout(flight.timer);
  if (inflight === flight) inflight = null;
  flight.controller.abort();
  if (failMessage !== null) store.failTurn(flight.turnId, failMessage);
}

export function sendTurn(opts: { input: TurnInput; display: string; via: "voice" | "text" | "tap" }): void {
  abortTurn();
  // Build the request before beginTurn so the new user line is not part of "thread".
  const body = store.buildTurnRequest(opts.input);
  // U2: the user line and the skeleton appear before any network.
  const turnId = store.beginTurn({ input: opts.input, display: opts.display, via: opts.via });
  const flight: Flight = { turnId, controller: new AbortController(), timer: undefined, ended: false };
  flight.timer = setTimeout(() => end(flight, "Timed out"), CLIENT_TIMEOUT_MS);
  inflight = flight;
  void stream(flight, body);
}

export function sendAction(action: A2uiAction): void {
  const summary = summarizeContext(action.context);
  sendTurn({
    input: { type: "action", action },
    display: summary ? action.name + " · " + summary : action.name,
    via: "tap",
  });
}

export function retryTurn(agentItemId: string): void {
  const item = store.getState().thread.find((i): i is AgentItem => i.kind === "agent" && i.id === agentItemId);
  if (!item) {
    console.warn("[turns] retryTurn: no agent item", agentItemId);
    return;
  }
  sendTurn(item.retry);
}

/** Stops the in-flight turn quietly: its agent item ends as "done", not as an error. */
export function abortTurn(): void {
  const flight = inflight;
  if (!flight) return;
  end(flight, null);
  const item = store.getState().thread.find((i): i is AgentItem => i.kind === "agent" && i.turnId === flight.turnId);
  if (item && (item.status === "pending" || item.status === "streaming")) {
    store.applyTurnEvent(flight.turnId, { type: "done" });
  }
}

async function stream(flight: Flight, body: TurnRequest): Promise<void> {
  try {
    const res = await apiFetch("/api/turn", {
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
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (flight.ended) return;
      buffer = normalizeNewlines(buffer + (done ? decoder.decode() : decoder.decode(value, { stream: true })), done);
      let sep = buffer.indexOf("\n\n");
      while (sep >= 0) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        if (handleBlock(flight.turnId, block)) {
          end(flight, null);
          return;
        }
        if (flight.ended) return;
        sep = buffer.indexOf("\n\n");
      }
      if (done) break;
    }
    if (buffer.trim() !== "" && handleBlock(flight.turnId, buffer)) {
      end(flight, null);
      return;
    }
    end(flight, "Connection closed");
  } catch (err) {
    if (flight.ended) return;
    end(flight, "Network error: " + (err instanceof Error ? err.message : String(err)));
  }
}

/** CRLF and CR become LF. A trailing CR may be half of a CRLF split across chunks, so it waits for the next chunk. */
function normalizeNewlines(s: string, final: boolean): string {
  const out = s.replace(/\r\n/g, "\n");
  return final ? out.replace(/\r/g, "\n") : out.replace(/\r(?=[\s\S])/g, "\n");
}

/** One SSE event block. Returns true when it carried the "done" event. */
function handleBlock(turnId: string, block: string): boolean {
  const data = block
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).replace(/^ /, ""));
  if (data.length === 0) return false;
  const payload = data.join("\n");
  let ev: unknown;
  try {
    ev = JSON.parse(payload);
  } catch (err) {
    console.warn("[turns] skipping an SSE event that is not JSON", shorten(payload, 200), err);
    return false;
  }
  if (!isPlainObject(ev) || typeof ev.type !== "string") {
    console.warn("[turns] skipping an SSE event without a type", shorten(payload, 200));
    return false;
  }
  store.applyTurnEvent(turnId, ev as TurnEvent);
  return ev.type === "done";
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
