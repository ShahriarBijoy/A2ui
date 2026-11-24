/**
 * Demo key handling: read once from ?k=, keep in memory, strip it from the address bar.
 * Stored in localStorage so a new tab or a browser restart on the stage machine keeps it (sessionStorage,
 * used before, is per tab: a reopened link without ?k= showed "demo key rejected").
 * Every /api call goes through apiFetch so the x-demo-key header is never forgotten.
 */
const STORAGE_KEY = "bb-demo-key";
let demoKey: string | null = null;

export function initDemoKey(): void {
  const url = new URL(window.location.href);
  const k = url.searchParams.get("k");
  if (k) {
    demoKey = k;
    localStorage.setItem(STORAGE_KEY, k);
    url.searchParams.delete("k");
    window.history.replaceState(null, "", url.toString());
  } else {
    demoKey = localStorage.getItem(STORAGE_KEY) ?? sessionStorage.getItem(STORAGE_KEY);
  }
}

export function hasDemoKey(): boolean {
  return demoKey !== null && demoKey !== "";
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (demoKey) headers.set("x-demo-key", demoKey);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(path, { ...init, headers });
}
