import { describe, expect, test } from "bun:test";
import { extractOgImage, fetchOgImages, OG_IMAGE_MAX_BYTES, OG_IMAGE_TIMEOUT_MS } from "./ogImage";

const PAGE = "https://cafe.example/en/menu";
const html = (head: string) => `<!doctype html><html><head><title>x</title>${head}</head><body>hi</body></html>`;

describe("extractOgImage", () => {
  test("extractOgImage reads og:image", () => {
    expect(extractOgImage(html('<meta property="og:image" content="https://cdn.example/a.jpg?w=800&amp;h=600">'), PAGE)).toBe("https://cdn.example/a.jpg?w=800&h=600");
    expect(extractOgImage(html("<meta content='https://cdn.example/b.jpg' property='og:image' />"), PAGE)).toBe("https://cdn.example/b.jpg");
    // og:image wins over twitter:image wherever it stands.
    const both = '<meta name="twitter:image" content="https://cdn.example/t.jpg"><META PROPERTY="OG:IMAGE" CONTENT="https://cdn.example/o.jpg">';
    expect(extractOgImage(html(both), PAGE)).toBe("https://cdn.example/o.jpg");
  });

  test("falls back to og:image:secure_url, then twitter:image", () => {
    expect(extractOgImage(html('<meta property="og:image:secure_url" content="https://cdn.example/s.jpg">'), PAGE)).toBe("https://cdn.example/s.jpg");
    expect(extractOgImage(html('<meta name="twitter:image" content="https://cdn.example/t.jpg">'), PAGE)).toBe("https://cdn.example/t.jpg");
    expect(extractOgImage(html('<meta name="twitter:image:src" content="https://cdn.example/t2.jpg">'), PAGE)).toBe("https://cdn.example/t2.jpg");
  });

  test("resolves a relative URL", () => {
    expect(extractOgImage(html('<meta property="og:image" content="/img/front.jpg">'), PAGE)).toBe("https://cafe.example/img/front.jpg");
    expect(extractOgImage(html('<meta property="og:image" content="//cdn.example/c.png">'), PAGE)).toBe("https://cdn.example/c.png");
  });

  test("ignores non-http URLs", () => {
    expect(extractOgImage(html('<meta property="og:image" content="data:image/png;base64,AAAA">'), PAGE)).toBeNull();
    expect(extractOgImage(html('<meta property="og:image" content="javascript:alert(1)">'), PAGE)).toBeNull();
    // A bad og:image does not hide a good fallback.
    const mixed = '<meta property="og:image" content="ftp://x/y.jpg"><meta name="twitter:image" content="https://cdn.example/t.jpg">';
    expect(extractOgImage(html(mixed), PAGE)).toBe("https://cdn.example/t.jpg");
  });

  test("returns null without a tag", () => {
    expect(extractOgImage(html('<meta name="description" content="A café">'), PAGE)).toBeNull();
    expect(extractOgImage(html('<meta property="og:image" content="">'), PAGE)).toBeNull();
    expect(extractOgImage("", PAGE)).toBeNull();
  });

  test("a huge page without a closing bracket stays fast", () => {
    const t0 = performance.now();
    expect(extractOgImage("<meta " + 'property="og:image" '.repeat(5000), PAGE)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });
});

/** A Response whose body yields `chunk` forever and counts how many bytes were pulled. */
function endless(chunk: string, type = "text/html; charset=utf-8") {
  const bytes = new TextEncoder().encode(chunk);
  const stats = { pulled: 0, cancelled: false };
  const body = new ReadableStream<Uint8Array>({
    pull(ctl) {
      stats.pulled += bytes.length;
      ctl.enqueue(bytes);
    },
    cancel() {
      stats.cancelled = true;
    },
  });
  return { res: new Response(body, { headers: { "content-type": type } }), stats };
}

const ok = (body: string, type = "text/html") => new Response(body, { status: 200, headers: { "content-type": type } });

describe("fetchOgImages", () => {
  test("parallel, in order; null for a missing url", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      return ok(html(`<meta property="og:image" content="${url}/photo.jpg">`));
    }) as unknown as typeof fetch;
    const out = await fetchOgImages(["https://a.example/p", null, "https://b.example/q"], fetchImpl, new AbortController().signal);
    expect(out).toEqual(["https://a.example/p/photo.jpg", null, "https://b.example/q/photo.jpg"]);
    expect(seen).toEqual(["https://a.example/p", "https://b.example/q"]);
  });

  test("fetchOgImages returns null on timeout, non-HTML and errors", async () => {
    let aborted = false;
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("slow")) {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        });
      }
      if (url.includes("hang-body")) return endless(" ").res;
      if (url.includes("jpeg")) return ok("\xff\xd8", "image/jpeg");
      if (url.includes("gone")) return new Response("nope", { status: 404, headers: { "content-type": "text/html" } });
      if (url.includes("boom")) throw new Error("network down");
      return ok(html('<meta property="og:image" content="https://cdn.example/fine.jpg">'));
    }) as unknown as typeof fetch;
    const t0 = performance.now();
    const out = await fetchOgImages(
      ["https://x.example/slow", "https://x.example/jpeg", "https://x.example/gone", "https://x.example/boom", "ftp://x.example/a", "https://x.example/fine"],
      fetchImpl,
      new AbortController().signal,
      { timeoutMs: 60 },
    );
    expect(out).toEqual([null, null, null, null, null, "https://cdn.example/fine.jpg"]);
    expect(aborted).toBe(true);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(OG_IMAGE_TIMEOUT_MS).toBe(1500);
  });

  test("a body that never ends is cut at the timeout", async () => {
    // A page of spaces reaches the byte cap at once and has no tag; a trickle never reaches it and hits the timeout.
    const fetchImpl = (async () => endless(" ").res) as unknown as typeof fetch;
    let pulls = 0;
    const trickle = (async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          async pull(ctl) {
            pulls++;
            await new Promise((r) => setTimeout(r, 30));
            ctl.enqueue(new TextEncoder().encode("<p>"));
          },
        }),
        { headers: { "content-type": "text/html" } },
      )) as unknown as typeof fetch;
    const t0 = performance.now();
    expect(await fetchOgImages(["https://x.example/trickle"], trickle, new AbortController().signal, { timeoutMs: 100 })).toEqual([null]);
    expect(performance.now() - t0).toBeLessThan(800);
    expect(pulls).toBeGreaterThan(0);
    expect(await fetchOgImages(["https://x.example/spaces"], fetchImpl, new AbortController().signal, { timeoutMs: 1000 })).toEqual([null]);
  });

  test("stops reading after the byte cap", async () => {
    const page = endless("<p>padding padding padding padding</p>".repeat(400));
    const fetchImpl = (async () => page.res) as unknown as typeof fetch;
    expect(await fetchOgImages(["https://x.example/big"], fetchImpl, new AbortController().signal)).toEqual([null]);
    expect(page.stats.pulled).toBeGreaterThanOrEqual(OG_IMAGE_MAX_BYTES);
    // At most one chunk past the cap (plus the stream's own read-ahead).
    expect(page.stats.pulled).toBeLessThan(OG_IMAGE_MAX_BYTES + 4 * 16_000);
    expect(page.stats.cancelled).toBe(true);
    expect(OG_IMAGE_MAX_BYTES).toBe(65536);
  });

  test("a tag inside the first 64 KB is found even when the page goes on", async () => {
    const head = html('<meta property="og:image" content="https://cdn.example/early.jpg">');
    const bytes = new TextEncoder().encode(head);
    let sentHead = false;
    const body = new ReadableStream<Uint8Array>({
      pull(ctl) {
        ctl.enqueue(sentHead ? new TextEncoder().encode("x".repeat(8000)) : bytes);
        sentHead = true;
      },
    });
    const fetchImpl = (async () => new Response(body, { headers: { "content-type": "text/html" } })) as unknown as typeof fetch;
    expect(await fetchOgImages(["https://x.example/long"], fetchImpl, new AbortController().signal)).toEqual(["https://cdn.example/early.jpg"]);
  });

  test("the turn going away ends every lookup at once", async () => {
    const ctl = new AbortController();
    const fetchImpl = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as unknown as typeof fetch;
    const t0 = performance.now();
    const pending = fetchOgImages(["https://x.example/a", "https://x.example/b"], fetchImpl, ctl.signal);
    setTimeout(() => ctl.abort(), 20);
    expect(await pending).toEqual([null, null]);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
