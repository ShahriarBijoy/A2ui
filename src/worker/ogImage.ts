/**
 * Photo URLs for search records: the og:image (or twitter:image) of each record's source page.
 * The composer never writes an image URL; the Worker reads it from the page the search cited.
 * Untrusted input on every side: per-page time and byte caps, http(s) only, a linear tag scan,
 * and every failure is simply null (the Image brick then shows nothing).
 */

export const OG_IMAGE_TIMEOUT_MS = 1500;
export const OG_IMAGE_MAX_BYTES = 65536;

/** Generic client name: no contact details, nothing about the person or the project. */
const USER_AGENT = "Mozilla/5.0 (compatible; BrickBoxPreview/1.0)";

/** Meta keys in the order they are trusted. */
const KEYS = ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"] as const;
const ATTR = /([a-zA-Z_:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
const ENTITY = /&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt);/gi;
const NAMED: Record<string, string> = { amp: "&", quot: '"', apos: "'", lt: "<", gt: ">" };

function decodeEntities(s: string): string {
  return s.replace(ENTITY, (all, e: string) => {
    const k = e.toLowerCase();
    if (k in NAMED) return NAMED[k];
    const code = k.startsWith("#x") ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
  });
}

function httpUrl(raw: string, base: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * The page's preview image: og:image, then og:image:secure_url, then twitter:image, relative URLs
 * resolved against pageUrl, http(s) only. The scan finds each "<meta" and the next ">": a tag that
 * never closes ends the scan, so a hostile page costs one pass.
 */
export function extractOgImage(html: string, pageUrl: string): string | null {
  const found = new Map<string, string>();
  const start = /<meta\b/gi;
  for (let m = start.exec(html); m !== null; m = start.exec(html)) {
    const end = html.indexOf(">", m.index);
    if (end < 0) break;
    const tag = html.slice(m.index, end);
    let key: string | null = null;
    let content: string | null = null;
    for (const a of tag.matchAll(ATTR)) {
      const name = a[1].toLowerCase();
      const value = a[2] ?? a[3] ?? a[4] ?? "";
      if (name === "property" || name === "name") key = value.trim().toLowerCase();
      else if (name === "content") content = value;
    }
    if (key && content !== null && !found.has(key) && (KEYS as readonly string[]).includes(key)) {
      const url = httpUrl(decodeEntities(content), pageUrl);
      if (url) found.set(key, url);
    }
    start.lastIndex = end + 1;
  }
  for (const k of KEYS) {
    const url = found.get(k);
    if (url) return url;
  }
  return null;
}

async function readCapped(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    // Stops the download: the rest of a big page is never read.
    reader.cancel().catch(() => {});
  }
  const buf = new Uint8Array(Math.min(total, maxBytes));
  let at = 0;
  for (const c of chunks) {
    if (at >= buf.length) break;
    const part = c.subarray(0, buf.length - at);
    buf.set(part, at);
    at += part.length;
  }
  // Default decoder: UTF-8, invalid bytes become U+FFFD (never throws).
  return new TextDecoder().decode(buf);
}

async function lookup(url: string, fetchImpl: typeof fetch, signal: AbortSignal, maxBytes: number): Promise<string | null> {
  const res = await fetchImpl(url, {
    signal,
    redirect: "follow",
    headers: { accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1", "user-agent": USER_AGENT },
  });
  const type = res.headers.get("content-type") ?? "";
  if (!res.ok || !res.body || !/\b(?:text\/html|application\/xhtml\+xml)\b/i.test(type)) {
    res.body?.cancel().catch(() => {});
    return null;
  }
  const html = await readCapped(res.body, maxBytes);
  return extractOgImage(html, res.url || url);
}

/** One page: null on any failure, after timeoutMs, or as soon as `outer` aborts. Never rejects. */
function lookupOne(url: string | null, fetchImpl: typeof fetch, outer: AbortSignal, timeoutMs: number, maxBytes: number): Promise<string | null> {
  if (!url || httpUrl(url, url) === null || outer.aborted) return Promise.resolve(null);
  const ctl = new AbortController();
  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      outer.removeEventListener("abort", onAbort);
      // Ends a request still running after the timeout or the turn's end; a no-op after an answer.
      ctl.abort();
      resolve(v);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), timeoutMs);
    outer.addEventListener("abort", onAbort, { once: true });
    lookup(url, fetchImpl, ctl.signal, maxBytes).then(finish, () => finish(null));
  });
}

/**
 * The preview image of each source page, in order and in parallel: per page at most timeoutMs
 * (default 1500 ms) and maxBytes read (default 64 KB); non-HTML, errors and timeouts are null.
 * Pass fetch wrapped in an arrow ((u, i) => fetch(u, i)): workerd rejects a detached fetch.
 */
export function fetchOgImages(
  urls: readonly (string | null)[],
  fetchImpl: typeof fetch,
  signal: AbortSignal,
  opts: { timeoutMs?: number; maxBytes?: number } = {},
): Promise<(string | null)[]> {
  const timeoutMs = opts.timeoutMs ?? OG_IMAGE_TIMEOUT_MS;
  const maxBytes = opts.maxBytes ?? OG_IMAGE_MAX_BYTES;
  return Promise.all(urls.map((u) => lookupOne(u, fetchImpl, signal, timeoutMs, maxBytes)));
}
