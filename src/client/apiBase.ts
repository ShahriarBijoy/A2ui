/**
 * Demo key handling. The key is entered once in the key box (KeyGate) or, optionally, read once from ?k= and
 * stripped from the address bar. It is kept in localStorage so a new tab or a browser restart on the stage
 * machine keeps it. A 401 clears it, which brings the key box back.
 * Every /api call goes through apiFetch so the x-demo-key header is never forgotten.
 */
const STORAGE_KEY = "bb-demo-key";
let demoKey: string | null = null;
const listeners = new Set<() => void>();

export function initDemoKey(): void {
  const url = new URL(window.location.href);
  const k = url.searchParams.get("k");
  if (k) {
    setDemoKey(k);
    url.searchParams.delete("k");
    window.history.replaceState(null, "", url.toString());
  } else {
    demoKey = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
  }
}

export function hasDemoKey(): boolean {
  return demoKey !== null && demoKey !== "";
}

export function setDemoKey(key: string): void {
  demoKey = key;
  localStorage.setItem(STORAGE_KEY, key);
  notify();
}

export function clearDemoKey(): void {
  demoKey = null;
  localStorage.removeItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  notify();
}

/** For useSyncExternalStore: fires when the key is set or cleared. */
export function subscribeDemoKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

export type KeyCheck = "ok" | "wrong" | "busy" | "unreachable";
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Asks the Worker whether a key is right before it is stored (GET /api/health needs the key). */
export async function checkDemoKey(key: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)): Promise<KeyCheck> {
  try {
    const res = await fetchImpl("/api/health", { headers: { "x-demo-key": key } });
    if (res.ok) return "ok";
    if (res.status === 401) return "wrong";
    if (res.status === 429) return "busy";
    return "unreachable";
  } catch {
    return "unreachable";
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  const sent = demoKey;
  if (sent) headers.set("x-demo-key", sent);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(path, { ...init, headers });
  // The stored key stopped working (changed on the server): forget it so the key box asks again.
  if (res.status === 401 && sent && sent === demoKey) clearDemoKey();
  return res;
}
