/**
 * Resolves composer "data" lines from demo data (PLAN §3.2): the model never writes
 * restaurants, flights, prices or times itself.
 */
import type { JsonObject, JsonValue } from "@shared/a2ui";
import type { DataSource, Flight, Place } from "@shared/protocol";
import { generateFlights, isIsoDate } from "./flights";
import placesJson from "./places.json";

export const PLACES: readonly Place[] = placesJson;
export const DATA_SOURCES: readonly DataSource[] = ["places", "flights"];
export const MAX_PLACES = 6;

export type DataRequest = { source: string; args: JsonObject };
/** Defaults for args the composer left out. */
export type DataDefaults = { from: string; date: string };
export type DataResult =
  | { ok: true; source: "places"; records: Place[] }
  | { ok: true; source: "flights"; records: Flight[] }
  | { ok: false; error: string };

export type PlaceQuery = { kind?: string; max_walk_min?: number };

export function resolveData(req: DataRequest, defaults: DataDefaults): DataResult {
  if (req.source === "places") {
    return { ok: true, source: "places", records: findPlaces(placeQuery(req.args)) };
  }
  if (req.source === "flights") {
    const to = str(req.args.to);
    if (!to) return { ok: false, error: "flights: missing 'to'" };
    const from = str(req.args.from) ?? defaults.from;
    const rawDate = str(req.args.date);
    // A date-time ("2026-11-24T09:00") still names the day.
    const day = rawDate?.slice(0, 10);
    const date = day && isIsoDate(day) ? day : defaults.date;
    return { ok: true, source: "flights", records: generateFlights(from, to, date) };
  }
  return { ok: false, error: `unknown data source "${req.source}"` };
}

export function placeQuery(args: JsonObject): PlaceQuery {
  const query: PlaceQuery = {};
  const kind = str(args.kind);
  if (kind) query.kind = kind;
  const walk = num(args.max_walk_min);
  if (walk !== undefined && walk > 0) query.max_walk_min = walk;
  return query;
}

/**
 * Filter by kind and walking time. If fewer than 2 places match, relax (walk first, then kind)
 * and append the relaxed places after the exact matches, so a requested kind stays on top.
 * Never returns an empty list.
 */
export function findPlaces(query: PlaceQuery, places: readonly Place[] = PLACES): Place[] {
  const kindOk = (p: Place) => !query.kind || matchesKind(p, query.kind);
  const walkOk = (p: Place) => query.max_walk_min === undefined || p.walk_min <= query.max_walk_min;
  const strict = byWalk(places.filter((p) => kindOk(p) && walkOk(p)));
  if (strict.length >= 2) return strict.slice(0, MAX_PLACES);
  const relaxations = [places.filter(kindOk), places.filter(walkOk), [...places]];
  const relaxed = relaxations.find((set) => set.length >= 2) ?? [...places];
  const extra = byWalk(relaxed.filter((p) => !strict.includes(p)));
  return [...strict, ...extra].slice(0, MAX_PLACES);
}

/** Case-insensitive substring match on kind or tags; any word of a multi-word kind ("italian food") counts. */
export function matchesKind(place: Place, kind: string): boolean {
  const haystack = [place.kind, ...place.tags].map((s) => s.toLowerCase());
  const q = kind.trim().toLowerCase();
  if (!q) return true;
  const words = [q, ...q.split(/[^\p{L}\p{N}-]+/u).filter((w) => w.length >= 3)];
  return words.some((w) => haystack.some((h) => h.includes(w)));
}

function byWalk(places: Place[]): Place[] {
  return [...places].sort((a, b) => a.walk_min - b.walk_min || a.id.localeCompare(b.id));
}

function str(v: JsonValue | undefined): string | undefined {
  if (typeof v === "string" && v.trim()) return v.trim();
  if (typeof v === "number") return String(v);
  return undefined;
}

function num(v: JsonValue | undefined): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
