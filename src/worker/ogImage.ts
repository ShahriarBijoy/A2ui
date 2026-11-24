/**
 * Photo URLs for search records: the og:image (or twitter:image) of each record's source page.
 * The composer never writes an image URL; the Worker reads it from the page the search cited.
 * Untrusted input on every side: per-page time and byte caps, http(s) only, a linear tag scan,
 * and every failure is simply null (the Image brick then shows nothing).
 */

export const OG_IMAGE_TIMEOUT_MS = 1500;
/** The meta tags live in the head: reading stops at "</head>" or after this many bytes. */
export const OG_IMAGE_MAX_BYTES = 32768;

/** Generic client name: no contact details, nothing about the person or the project. */
const USER_AGENT = "Mozilla/5.0 (compatible; BrickBoxPreview/1.0)";

/** Meta keys in the order they are trusted. */
const KEYS = ["og:image", "og:image:url", "og:image:secure_url", "twitter:image", "twitter:image:src"] as const;
/** Where a meta tag starts: fixed length, so the search is one linear pass. */
const META_START = /<meta[\s/>]/gi;
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

function isNameChar(c: number): boolean {
  // A-Z a-z 0-9 _ : . -
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || (c >= 48 && c <= 57) || c === 95 || c === 58 || c === 46 || c === 45;
}

function isSpace(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12;
}

/**
 * property/name and content of one meta tag body, in one left-to-right pass: every step moves the
 * index forward, so a tag costs at most its length (no regex, nothing to backtrack).
 */
export function metaAttributes(tag: string): { key: string | null; content: string | null } {
  let key: string | null = null;
  let content: string | null = null;
  const n = tag.length;
  let i = 0;
  while (i < n) {
    while (i < n && !isNameChar(tag.charCodeAt(i))) i++;
    const nameStart = i;
    while (i < n && isNameChar(tag.charCodeAt(i))) i++;
    if (i === nameStart) break;
    const name = i - nameStart <= 16 ? tag.slice(nameStart, i).toLowerCase() : "";
    while (i < n && isSpace(tag.charCodeAt(i))) i++;
    if (tag.charCodeAt(i) !== 61 /* = */) continue;
    i++;
    while (i < n && isSpace(tag.charCodeAt(i))) i++;
    let value: string;
    const q = tag[i];
    if (q === '"' || q === "'") {
      const close = tag.indexOf(q, i + 1);
      const end = close < 0 ? n : close;
      value = tag.slice(i + 1, end);
      i = end + 1;
    } else {
      const valueStart = i;
      while (i < n && !isSpace(tag.charCodeAt(i))) i++;
      value = tag.slice(valueStart, i);
    }
    if (name === "property" || name === "name") key = value.trim().toLowerCase();
    else if (name === "content") content = value;
  }
  return { key, content };
}

/**
 * The page's preview image: og:image, then og:image:secure_url, then twitter:image, relative URLs
 * resolved against pageUrl, http(s) only. Linear in the page: each "<meta" start is found once, a tag
 * that never closes ends the scan, and attributes are read in one pass (Workers Free allows 10 ms CPU).
 */
export function extractOgImage(html: string, pageUrl: string): string | null {
  const found = new Map<string, string>();
  const start = new RegExp(META_START.source, META_START.flags);
  for (let m = start.exec(html); m !== null; m = start.exec(html)) {
    const end = html.indexOf(">", m.index + 5);
    if (end < 0) break;
    const { key, content } = metaAttributes(html.slice(m.index + 5, end));
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

/** The page up to "</head>" (exclusive) or maxBytes, whichever comes first; the rest is never downloaded. */
async function readHead(body: ReadableStream<Uint8Array>, maxBytes: number): Promise<string> {
  const reader = body.getReader();
  // Default decoder: UTF-8, invalid bytes become U+FFFD (never throws).
  const decoder = new TextDecoder();
  let html = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        html += decoder.decode();
        break;
      }
      const take = value.subarray(0, maxBytes - bytes);
      bytes += take.byteLength;
      // Only the new text (and a "</head" split across chunks) is searched.
      const from = Math.max(0, html.length - 6);
      html += decoder.decode(take, { stream: true });
      const close = html.slice(from).toLowerCase().indexOf("</head");
      if (close >= 0) return html.slice(0, from + close);
    }
  } finally {
    // Stops the download: the rest of a big page is never read.
    reader.cancel().catch(() => {});
  }
  return html;
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
  const html = await readHead(res.body, maxBytes);
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
 * (default 1500 ms) and the head read (at most maxBytes, default 32 KB); non-HTML, errors and timeouts are null.
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
