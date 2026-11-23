import { describe, expect, test } from "bun:test";
import { createPredictScheduler } from "./predictClient";
import type { Timers } from "./transcript";

function fakeClock() {
  let now = 0;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: Timers = {
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const due = [...pending.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      pending.delete(due[0]);
      now = due[1].at;
      due[1].fn();
    }
    now = end;
  };
  return { timers, advance };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function setup() {
  const clock = fakeClock();
  const sent: string[] = [];
  const calls: ReturnType<typeof deferred<string | null>>[] = [];
  const results: string[] = [];
  const s = createPredictScheduler<string>({
    delayMs: 350,
    minWords: 3,
    timers: clock.timers,
    send: (text) => {
      sent.push(text);
      const d = deferred<string | null>();
      calls.push(d);
      return d.promise;
    },
    onResult: (r) => results.push(r),
  });
  return { clock, sent, calls, results, s };
}

describe("createPredictScheduler", () => {
  test("waits for the debounce and sends only the latest text", () => {
    const { clock, sent, s } = setup();
    s.update("book a table");
    clock.advance(200);
    s.update("book a table for four");
    clock.advance(349);
    expect(sent).toEqual([]);
    clock.advance(1);
    expect(sent).toEqual(["book a table for four"]);
  });

  test("ignores text below the minimum word count", () => {
    const { clock, sent, s } = setup();
    s.update("book a");
    clock.advance(1000);
    expect(sent).toEqual([]);
  });

  test("does not resend identical text", () => {
    const { clock, sent, s } = setup();
    s.update("book a table");
    clock.advance(350);
    s.update("book  a table ");
    clock.advance(1000);
    expect(sent).toHaveLength(1);
  });

  test("drops a stale response when a newer request is in flight", async () => {
    const { clock, calls, results, s } = setup();
    s.update("one two three");
    clock.advance(350);
    s.update("one two three four");
    clock.advance(350);
    calls[1]!.resolve("new");
    await flush();
    calls[0]!.resolve("old");
    await flush();
    expect(results).toEqual(["new"]);
  });

  test("cancel invalidates in-flight responses and pending timers", async () => {
    const { clock, sent, calls, results, s } = setup();
    s.update("one two three");
    clock.advance(350);
    s.update("one two three four");
    s.cancel();
    clock.advance(1000);
    expect(sent).toHaveLength(1);
    calls[0]!.resolve("late");
    await flush();
    expect(results).toEqual([]);
  });

  test("null and rejected responses are silent", async () => {
    const { clock, calls, results, s } = setup();
    s.update("one two three");
    clock.advance(350);
    calls[0]!.resolve(null);
    await flush();
    expect(results).toEqual([]);
  });
});
