/**
 * Demo data (PLAN §3.2). Data lines with source "flights" resolve here from a deterministic generator
 * (every record demo: true). Live facts come from "search" lines (../search.ts); widgets mode's
 * restaurant list uses the same search (../restaurants.ts). There is no fixed place list.
 */
import type { JsonObject, JsonValue } from "@shared/a2ui";
import type { DataSource, Flight } from "@shared/protocol";
import { generateFlights, isIsoDate } from "./flights";

/** Sources a composer data line may name. */
export const DATA_SOURCES: readonly DataSource[] = ["search", "flights"];

export type DataRequest = { source: string; args: JsonObject };
/** Defaults for args the composer left out. */
export type DataDefaults = { from: string; date: string };
/** `query` is what was resolved, for the fetch event (e.g. "Bremen → New York 2026-11-24"). */
export type DataResult = { ok: true; source: "flights"; query: string; records: Flight[] } | { ok: false; error: string };

/** Demo sources only; "search" lines are resolved by the turn loop. */
export function resolveData(req: DataRequest, defaults: DataDefaults): DataResult {
  if (req.source === "flights") {
    const to = str(req.args.to);
    if (!to) return { ok: false, error: "flights: missing 'to'" };
    const from = str(req.args.from) ?? defaults.from;
    const rawDate = str(req.args.date);
    // A date-time ("2026-11-24T09:00") still names the day.
    const day = rawDate?.slice(0, 10);
    const date = day && isIsoDate(day) ? day : defaults.date;
    return { ok: true, source: "flights", query: `${from} → ${to} ${date}`, records: generateFlights(from, to, date) };
  }
  return { ok: false, error: `unknown data source "${req.source}"` };
}

function str(v: JsonValue | undefined): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}
