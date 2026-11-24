import { beforeEach, describe, expect, test } from "bun:test";
import { checkDemoKey, clearDemoKey, hasDemoKey, setDemoKey, subscribeDemoKey } from "./apiBase";

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

beforeEach(() => {
  Object.assign(globalThis, { localStorage: new MemoryStorage(), sessionStorage: new MemoryStorage() });
});

const reply = (status: number) => async () => new Response("{}", { status });

describe("demo key", () => {
  test("set stores it and notifies; clear forgets it everywhere and notifies", () => {
    let calls = 0;
    const off = subscribeDemoKey(() => calls++);
    setDemoKey("k1");
    expect(hasDemoKey()).toBe(true);
    expect(localStorage.getItem("bb-demo-key")).toBe("k1");
    sessionStorage.setItem("bb-demo-key", "old");
    clearDemoKey();
    expect(hasDemoKey()).toBe(false);
    expect(localStorage.getItem("bb-demo-key")).toBeNull();
    expect(sessionStorage.getItem("bb-demo-key")).toBeNull();
    expect(calls).toBe(2);
    off();
    setDemoKey("k2");
    expect(calls).toBe(2);
  });

  test("checkDemoKey maps the health answer", async () => {
    expect(await checkDemoKey("k", reply(200))).toBe("ok");
    expect(await checkDemoKey("k", reply(401))).toBe("wrong");
    expect(await checkDemoKey("k", reply(429))).toBe("busy");
    expect(await checkDemoKey("k", reply(502))).toBe("unreachable");
    expect(await checkDemoKey("k", async () => Promise.reject(new TypeError("offline")))).toBe("unreachable");
  });

  test("checkDemoKey sends the key it checks", async () => {
    const seen: (string | null)[] = [];
    await checkDemoKey("abc", async (_input, init) => {
      seen.push(new Headers(init?.headers).get("x-demo-key"));
      return new Response("{}", { status: 200 });
    });
    expect(seen).toEqual(["abc"]);
  });
});
