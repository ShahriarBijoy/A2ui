/**
 * Demo key handling: read once from ?k=, keep in memory, strip it from the address bar.
 * Every /api call goes through apiFetch so the x-demo-key header is never forgotten.
 */
let demoKey: string | null = null;

export function initDemoKey(): void {
  const url = new URL(window.location.href);
  const k = url.searchParams.get("k");
  if (k) {
    demoKey = k;
    sessionStorage.setItem("bb-demo-key", k);
    url.searchParams.delete("k");
    window.history.replaceState(null, "", url.toString());
  } else {
    demoKey = sessionStorage.getItem("bb-demo-key");
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
