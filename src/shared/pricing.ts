/**
 * Cost meter: measured tokens × published list prices, in USD. Nothing here is measured itself:
 * the token counts come from the API responses, the prices from the pages below (checked 2026-11-25).
 *   Claude: https://platform.claude.com/docs/en/about-claude/pricing (5-minute cache writes: the composer's
 *           cache_control is "ephemeral" with no ttl; Haiku 5.5 rates are for prompts up to 100K tokens)
 *   Web search: $10 per 1,000 searches (same page)
 *   Jev: $0.042 per million input tokens, output free. Third-party listings (OpenRouter, eesel.ai);
 *        TypeSafe has no pricing page, so the UI never shows this share as an exact figure.
 * Not counted: speech to text (Soniox) and the brick guesses while speaking (/api/predict).
 */
import type { TurnEvent } from "./protocol";

export const PRICES_CHECKED = "2026-11-25";

/** USD per million tokens. */
export type ModelPrice = { input: number; cacheWrite: number; cacheRead: number; output: number };

export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  // The composer's server-side refusal fallback can be served by Sonnet 5.
  "claude-sonnet-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5 },
};

export const WEB_SEARCH_USD = 10 / 1000;
export const JEV_INPUT_PER_MTOK = 0.042;

type UsageEvent = Extract<TurnEvent, { type: "usage" }>;
type FetchEvent = Extract<TurnEvent, { type: "fetch" }>;
type RouteEvent = Extract<TurnEvent, { type: "route" }>;

const PER_TOKEN = 1 / 1_000_000;

function count(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
}

/** A dated id ("claude-haiku-5-5-20261001") prices like its alias. */
export function priceFor(model: string | undefined): ModelPrice | null {
  if (!model) return null;
  return MODEL_PRICES[model] ?? MODEL_PRICES[model.replace(/-\d{8}$/, "")] ?? null;
}

/** One Claude call. null when the model has no known price (the meter then shows nothing for it). */
export function usageCost(u: Pick<UsageEvent, "model" | "input_tokens" | "output_tokens" | "cache_read_tokens" | "cache_write_tokens">): number | null {
  const p = priceFor(u.model);
  if (!p) return null;
  return (
    (count(u.input_tokens) * p.input +
      count(u.cache_write_tokens) * p.cacheWrite +
      count(u.cache_read_tokens) * p.cacheRead +
      count(u.output_tokens) * p.output) *
    PER_TOKEN
  );
}

/**
 * One data line. Search: the search model's tokens plus the per-search fee. Sources without an LLM
 * (weather) cost nothing here. null when a search has no model name (recordings made before it existed).
 */
export function fetchCost(f: Pick<FetchEvent, "source" | "model" | "searches" | "input_tokens" | "output_tokens">): number | null {
  if (f.source !== "search") return 0;
  const p = priceFor(f.model);
  if (!p) return null;
  return (count(f.input_tokens) * p.input + count(f.output_tokens) * p.output) * PER_TOKEN + count(f.searches) * WEB_SEARCH_USD;
}

/** The decision model's share. null when the route event carries no token count (Jev never reached, or an old recording). */
export function routeCost(r: Pick<RouteEvent, "input_tokens">): number | null {
  if (r.input_tokens === undefined || !Number.isFinite(r.input_tokens)) return null;
  return count(r.input_tokens) * JEV_INPUT_PER_MTOK * PER_TOKEN;
}

/**
 * "$0.019", "$0.0042", "<$0.001". Below a tenth of a cent the meter says only that: the Jev share is an
 * estimate from third-party listings, and the stage should never read it as an exact figure.
 */
export function formatUsd(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return "$0";
  if (usd < 0.001) return "<$0.001";
  if (usd < 0.01) return "$" + usd.toFixed(4);
  if (usd < 10) return "$" + usd.toFixed(3);
  return "$" + usd.toFixed(2);
}
