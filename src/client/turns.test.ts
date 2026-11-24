import { describe, expect, spyOn, test } from "bun:test";
import type { TurnEvent } from "@shared/protocol";
import type { AgentItem } from "@/state";
import { createStore } from "@/store";
import { CLIENT_TIMEOUT_MS, createSseParser, createTurnClient } from "./turns";

const enc = new TextEncoder();
const sse = (ev: TurnEvent) => "data: " + JSON.stringify(ev) + "\n\n";
const utter = (text: string) => ({ input: { type: "utterance" as const, text }, display: text, via: "text" as const });

function controlledBody() {
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  const c = () => {
    if (!ctrl) throw new Error("stream not started");
    return ctrl;
  };
  return {
    body,
    push: (s: string) => c().enqueue(enc.encode(s)),
    close: () => c().close(),
    fail: (e: unknown) => c().error(e),
  };
}

function harness(mode: { status?: number; text?: string; reject?: Error } = {}) {
  const store = createStore();
  const streams: ReturnType<typeof controlledBody>[] = [];
  const requests: { path: string; init: RequestInit }[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const fetch = (path: string, init: RequestInit): Promise<Response> => {
    requests.push({ path, init });
    if (mode.reject) return Promise.reject(mode.reject);
    if (mode.status) return Promise.resolve(new Response(mode.text ?? "", { status: mode.status }));
    const s = controlledBody();
    streams.push(s);
    // Like real fetch: aborting the request errors the body.
    init.signal?.addEventListener("abort", () => s.fail(new DOMException("aborted", "AbortError")));
    return Promise.resolve(new Response(s.body, { status: 200, headers: { "content-type": "text/event-stream" } }));
  };
  const client = createTurnClient({
    store,
    fetch,
    setTimer: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimer: () => {},
  });
  const agent = (turnId: string) =>
    store.getState().thread.find((i): i is AgentItem => i.kind === "agent" && i.turnId === turnId);
  const lastTurn = () => store.getState().thread.at(-1)?.turnId ?? "";
  return { store, client, streams, requests, timers, agent, lastTurn };
}

describe("SSE parser", () => {
  test("chunk boundaries mid-line and mid-event, CRLF split across chunks", () => {
    const p = createSseParser();
    expect(p.push('data: {"type":"cap')).toEqual([]);
    expect(p.push('tion","text":"hi"}\r')).toEqual([]);
    expect(p.push("\n\r")).toEqual([]);
    expect(p.push("\n")).toEqual(['{"type":"caption","text":"hi"}']);
  });
  test("several events per chunk; comments and other fields are ignored; multi-line data is joined", () => {
    const p = createSseParser();
    const out = p.push(
      'data: {"type":"text","delta":"a"}\n\n: keep-alive\n\nevent: message\ndata: {"type":"text",\ndata: "delta":"b"}\n\ndata: {"type":"do',
    );
    expect(out).toEqual(['{"type":"text","delta":"a"}', '{"type":"text",\n"delta":"b"}']);
    expect(p.push('ne"}')).toEqual([]);
    // The last event may end without its blank line.
    expect(p.end()).toEqual(['{"type":"done"}']);
  });
  test("lone CR line endings", () => {
    const p = createSseParser();
    expect(p.push('data: {"type":"done"}\r\r')).toEqual([]);
    expect(p.end()).toEqual(['{"type":"done"}']);
  });
});

describe("turn client", () => {
  test("streams events in any chunking into the store; done ends the turn without an error", async () => {
    const h = harness();
    const promise = h.client.sendTurn(utter("table for four"));
    const turnId = h.lastTurn();
    // U2: the user line and the pending item exist before any network reply.
    expect(h.agent(turnId)?.status).toBe("pending");
    const wire =
      sse({ type: "caption", text: "Table" }) +
      sse({ type: "a2ui", origin: "llm", msg: { version: "1.0", createSurface: { surfaceId: "s1", catalogId: "x/catalog/brick-box/v1" } } }) +
      sse({ type: "a2ui", origin: "llm", msg: { version: "1.0", updateComponents: { surfaceId: "s1", components: [{ id: "root", component: "Divider" }] } } }) +
      sse({ type: "done" });
    for (let i = 0; i < wire.length; i += 7) h.streams[0].push(wire.slice(i, i + 7));
    await promise;
    const a = h.agent(turnId);
    expect(a).toMatchObject({ status: "done", caption: "Table", surfaceId: "s1" });
    expect(a?.error).toBeUndefined();
    expect(h.store.getState().activeTurnId).toBeNull();
    expect(h.requests[0].path).toBe("/api/turn");
    expect(h.requests[0].init.method).toBe("POST");
    const body = JSON.parse(String(h.requests[0].init.body));
    expect(body.input).toEqual({ type: "utterance", text: "table for four" });
    // Built before beginTurn: the new user line is not in the thread.
    expect(body.thread).toEqual([]);
  });

  test("non-2xx → failTurn with the status and a short body", async () => {
    const h = harness({ status: 500, text: "boom\n  upstream" });
    await h.client.sendTurn(utter("x"));
    expect(h.agent(h.lastTurn())).toMatchObject({ status: "error", error: "HTTP 500: boom upstream" });
  });

  test("401 and 429 → a line that says what to do", async () => {
    const a = harness({ status: 401, text: '{"error":"unauthorized"}' });
    await a.client.sendTurn(utter("x"));
    expect(a.agent(a.lastTurn())).toMatchObject({ status: "error", error: "Demo key missing or wrong: enter it again." });
    const b = harness({ status: 429, text: '{"error":"Too many requests"}' });
    await b.client.sendTurn(utter("x"));
    expect(b.agent(b.lastTurn())).toMatchObject({ status: "error", error: "Too many requests: wait a minute, then try again." });
  });

  test("network error → failTurn", async () => {
    const h = harness({ reject: new Error("offline") });
    await h.client.sendTurn(utter("x"));
    expect(h.agent(h.lastTurn())).toMatchObject({ status: "error", error: "Network error: offline" });
  });

  test('stream ends without "done" → "Connection closed"', async () => {
    const h = harness();
    const promise = h.client.sendTurn(utter("x"));
    h.streams[0].push(sse({ type: "caption", text: "half" }));
    h.streams[0].close();
    await promise;
    expect(h.agent(h.lastTurn())).toMatchObject({ status: "error", error: "Connection closed", caption: "half" });
  });

  test("a server error before the close keeps the server's message", async () => {
    const h = harness();
    const promise = h.client.sendTurn(utter("x"));
    h.streams[0].push(sse({ type: "error", message: "compose timed out" }));
    h.streams[0].close();
    await promise;
    expect(h.agent(h.lastTurn())).toMatchObject({ status: "error", error: "compose timed out" });
  });

  test("a new sendTurn aborts the previous turn quietly (done, not error)", async () => {
    const h = harness();
    const first = h.client.sendTurn(utter("first"));
    const t1 = h.lastTurn();
    h.streams[0].push(sse({ type: "caption", text: "building" }));
    await Bun.sleep(5);
    const second = h.client.sendTurn(utter("second"));
    const t2 = h.lastTurn();
    await first;
    expect(h.agent(t1)).toMatchObject({ status: "done", caption: "building" });
    expect(h.agent(t1)?.error).toBeUndefined();
    expect(h.store.getState().recordings[t1].events.at(-1)?.ev).toEqual({ type: "done" });
    expect(h.store.getState().activeTurnId).toBe(t2);
    h.streams[1].push(sse({ type: "done" }));
    await second;
    expect(h.agent(t2)?.status).toBe("done");
    expect(h.store.getState().activeTurnId).toBeNull();
  });

  test("abortTurn stops the stream quietly", async () => {
    const h = harness();
    const promise = h.client.sendTurn(utter("x"));
    h.client.abortTurn();
    await promise;
    expect(h.agent(h.lastTurn())?.status).toBe("done");
  });

  test("the 25 s safety timeout aborts and fails the turn; nothing after it is applied", async () => {
    const h = harness();
    const promise = h.client.sendTurn(utter("slow"));
    expect(h.timers[0].ms).toBe(CLIENT_TIMEOUT_MS);
    expect(CLIENT_TIMEOUT_MS).toBe(25_000);
    h.timers[0].fn();
    await promise;
    const t = h.lastTurn();
    expect(h.agent(t)).toMatchObject({ status: "error", error: "Timed out" });
    expect(h.store.getState().activeTurnId).toBeNull();
    const events = h.store.getState().recordings[t].events.length;
    h.timers[0].fn();
    expect(h.store.getState().recordings[t].events.length).toBe(events);
  });

  test("an unparsable event is skipped (and logged); the stream goes on", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    const h = harness();
    const promise = h.client.sendTurn(utter("x"));
    h.streams[0].push("data: {not json\n\n" + sse({ type: "caption", text: "ok" }) + sse({ type: "done" }));
    await promise;
    expect(h.agent(h.lastTurn())).toMatchObject({ status: "done", caption: "ok" });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  test("sendAction sends the action as input with a short display line", async () => {
    const h = harness();
    const promise = h.client.sendAction({
      name: "confirm_booking",
      surfaceId: "s2",
      sourceComponentId: "confirm",
      timestamp: "2026-11-23T19:00:00.000Z",
      context: { place: "Bistro", time: ["19:00"], guests: 4 },
    });
    const user = h.store.getState().thread[0];
    expect(user).toMatchObject({ kind: "user", via: "tap", text: "confirm_booking · Bistro, 19:00, 4" });
    expect(JSON.parse(String(h.requests[0].init.body)).input.type).toBe("action");
    h.client.abortTurn();
    await promise;
  });
});
