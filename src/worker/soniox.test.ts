import { describe, expect, test } from "bun:test";
import { createSonioxKey, SONIOX_TEMP_KEY_URL, SonioxKeyError } from "./soniox";

describe("createSonioxKey", () => {
  test("posts the documented body with the bearer key and returns {api_key, expires_at}", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const res = await createSonioxKey("secret-long-key", async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ api_key: "temp", expires_at: "2026-11-23T20:00:00Z", extra: 1 }), { status: 201 });
    });
    expect(res).toEqual({ api_key: "temp", expires_at: "2026-11-23T20:00:00Z" });
    expect(seen!.url).toBe(SONIOX_TEMP_KEY_URL);
    expect(seen!.init.method).toBe("POST");
    expect((seen!.init.headers as Record<string, string>).Authorization).toBe("Bearer secret-long-key");
    expect(JSON.parse(String(seen!.init.body))).toEqual({
      usage_type: "transcribe_websocket",
      expires_in_seconds: 600,
      client_reference_id: "brick-box",
    });
  });

  test("missing key → SonioxKeyError, no request", async () => {
    let called = false;
    const p = createSonioxKey("", async () => {
      called = true;
      return new Response("{}");
    });
    await expect(p).rejects.toBeInstanceOf(SonioxKeyError);
    expect(called).toBe(false);
  });

  test("upstream error → message with status and error_type, never the key", async () => {
    try {
      await createSonioxKey("secret-long-key", async () =>
        new Response(JSON.stringify({ error_type: "unauthenticated", message: "bad key secret-long-key" }), { status: 401 }),
      );
      throw new Error("expected a throw");
    } catch (err) {
      expect(err).toBeInstanceOf(SonioxKeyError);
      expect((err as Error).message).toBe("Soniox temporary key failed: HTTP 401 unauthenticated");
      expect((err as Error).message).not.toContain("secret");
    }
  });

  test("network failure and malformed body → SonioxKeyError", async () => {
    await expect(createSonioxKey("k", async () => Promise.reject(new TypeError("down")))).rejects.toBeInstanceOf(SonioxKeyError);
    await expect(createSonioxKey("k", async () => new Response("{}", { status: 201 }))).rejects.toBeInstanceOf(SonioxKeyError);
  });
});
