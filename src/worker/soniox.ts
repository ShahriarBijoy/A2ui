/**
 * Mints a short-lived Soniox key for the browser (docs.soniox.com, "Temporary API keys", checked 2026-11-23):
 * POST /v1/auth/temporary-api-key → 201 {api_key, expires_at}. The long-lived key never leaves the Worker.
 */
import type { SonioxKeyResponse } from "@shared/protocol";

export const SONIOX_TEMP_KEY_URL = "https://api.soniox.com/v1/auth/temporary-api-key";
const TIMEOUT_MS = 5_000;

export class SonioxKeyError extends Error {}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export async function createSonioxKey(
  apiKey: string | undefined,
  // Wrapped so workerd's fetch keeps its receiver.
  fetchImpl: Fetch = (input, init) => fetch(input, init),
): Promise<SonioxKeyResponse> {
  if (!apiKey) throw new SonioxKeyError("SONIOX_API_KEY is not set");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetchImpl(SONIOX_TEMP_KEY_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        usage_type: "transcribe_websocket",
        expires_in_seconds: 600,
        client_reference_id: "brick-box",
      }),
      signal: ctl.signal,
    });
  } catch (err) {
    throw new SonioxKeyError(ctl.signal.aborted ? "Soniox did not answer in time" : `Soniox unreachable: ${errorName(err)}`);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // error_type is a fixed category ("unauthenticated", ...); never echo the request.
    const errorType = await res
      .json()
      .then((b: unknown) => (isRecord(b) && typeof b.error_type === "string" ? b.error_type : ""))
      .catch(() => "");
    throw new SonioxKeyError(`Soniox temporary key failed: HTTP ${res.status}${errorType ? ` ${errorType}` : ""}`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!isRecord(body) || typeof body.api_key !== "string" || typeof body.expires_at !== "string") {
    throw new SonioxKeyError("Soniox temporary key: unexpected response");
  }
  return { api_key: body.api_key, expires_at: body.expires_at };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "error";
}
