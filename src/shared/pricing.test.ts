import { describe, expect, test } from "bun:test";
import { fetchCost, formatUsd, priceFor, routeCost, usageCost, WEB_SEARCH_USD } from "./pricing";

describe("pricing", () => {
  test("a composer call: uncached input, cache read, output (replay F1's measured tokens)", () => {
    const usd = usageCost({ model: "claude-sonnet-5-5", input_tokens: 239, output_tokens: 576, cache_read_tokens: 6038, cache_write_tokens: 0 });
    expect(usd).toBeCloseTo((239 * 2 + 6038 * 0.1 + 576 * 10) / 1e6, 10);
  });

  test("cache writes use the 5-minute write price", () => {
    const usd = usageCost({ model: "claude-sonnet-5-5", input_tokens: 0, output_tokens: 0, cache_write_tokens: 1_000_000 });
    expect(usd).toBeCloseTo(2.5, 10);
  });

  test("an unknown model has no price, never a guess", () => {
    expect(usageCost({ model: "claude-mystery-9", input_tokens: 100, output_tokens: 100 })).toBeNull();
    expect(priceFor(undefined)).toBeNull();
  });

  test("a dated model id prices like its alias", () => {
    expect(priceFor("claude-haiku-5-5-20261001")).toEqual(priceFor("claude-haiku-5-5"));
  });

  test("a search: search model tokens plus the per-search fee", () => {
    const usd = fetchCost({ source: "search", model: "claude-haiku-5-5", searches: 1, input_tokens: 15353, output_tokens: 867 });
    expect(usd).toBeCloseTo((15353 * 0.1 + 867 * 0.5) / 1e6 + WEB_SEARCH_USD, 10);
  });

  test("a search without a model name (old recording) is unknown; weather costs nothing here", () => {
    expect(fetchCost({ source: "search", searches: 1, input_tokens: 100, output_tokens: 10 })).toBeNull();
    expect(fetchCost({ source: "weather" })).toBe(0);
  });

  test("the decision model: tokens when present, unknown when the field is missing", () => {
    expect(routeCost({ input_tokens: 2000 })).toBeCloseTo((2000 * 0.042) / 1e6, 12);
    expect(routeCost({ input_tokens: 0 })).toBe(0);
    expect(routeCost({})).toBeNull();
  });

  test("formatUsd never shows the tiny Jev share as an exact figure", () => {
    expect(formatUsd(0)).toBe("$0");
    expect(formatUsd(0.000084)).toBe("<$0.001");
    expect(formatUsd(0.0042)).toBe("$0.0042");
    expect(formatUsd(0.0188)).toBe("$0.019");
    expect(formatUsd(12.345)).toBe("$12.35");
    expect(formatUsd(Number.NaN)).toBe("$0");
  });
});
