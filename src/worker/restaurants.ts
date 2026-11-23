/**
 * Widgets mode's restaurant list on live data (owner rule: no fixed data). show_restaurants runs the
 * same web search as a2ui data lines (search.ts validates the answer); this module turns the tool
 * input into that search and its records into the widget's rows. A fact no result states stays null.
 */
import type { JsonObject, JsonValue } from "@shared/a2ui";
import type { Place } from "@shared/protocol";
import type { PromptContext } from "./prompts";
import { DEFAULT_SEARCH_ITEMS, parseSearchArgs, type SearchRequest } from "./search";

export type PlaceQuery = { kind?: string; max_walk_min?: number };

/** The keys the widget shows; search.ts carries a hint for each, and adds "source". */
export const PLACE_FIELDS: readonly string[] = ["name", "kind", "walk_min", "price_level", "tags", "opens_until"];
/** The kind comes from the person's words via the widgets model: keep it a short phrase in the query. */
const MAX_KIND_CHARS = 60;
const MAX_WALK_MIN = 120;
/** A kind that already names a type of place ("pub", "pizzeria") is not followed by "restaurants". */
const PLACE_NOUN = /\b(restaurants?|pubs?|bars?|caf[eé]s?|bistros?|diners?|eater(?:y|ies)|brasseries?|trattorias?|pizzerias?|steakhouses?|places?|food)\b/i;

export function placeQuery(args: JsonObject): PlaceQuery {
  const query: PlaceQuery = {};
  const kind = typeof args.kind === "string" ? args.kind.trim().replace(/\s+/g, " ").slice(0, MAX_KIND_CHARS).trim() : "";
  if (kind) query.kind = kind;
  const walk = num(args.max_walk_min);
  if (walk !== undefined && walk > 0) query.max_walk_min = walk;
  return query;
}

/**
 * "<kind> restaurants near <venue address>". The walking limit stays out of the query: results
 * rarely state walking time from the venue, and the search drops items not shown meeting every
 * condition, so it would mostly come back empty. Only a stated time can rule a place out (recordsToPlaces).
 */
export function restaurantSearch(q: PlaceQuery, ctx: PromptContext): SearchRequest {
  const what = !q.kind ? "restaurants" : PLACE_NOUN.test(q.kind) ? q.kind : `${q.kind} restaurants`;
  const parsed = parseSearchArgs({ query: `${what} near ${venueWhere(ctx)}`, fields: [...PLACE_FIELDS], max: DEFAULT_SEARCH_ITEMS });
  // Unreachable: the query always has text. Fail loudly rather than search for something else.
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.req;
}

/** The street address when configured (it usually ends in the city already), else venue and city. */
function venueWhere(ctx: PromptContext): string {
  if (!ctx.address) return `${ctx.venue}, ${ctx.city}`;
  return ctx.address.toLowerCase().includes(ctx.city.toLowerCase()) ? ctx.address : `${ctx.address}, ${ctx.city}`;
}

/** Search records → widget rows. Rows without a name are dropped; so is a stated walk over the limit. */
export function recordsToPlaces(records: readonly JsonObject[], maxWalk?: number): Place[] {
  const places: Place[] = [];
  for (const r of records) {
    const name = typeof r.name === "string" && r.name.trim() ? r.name.trim() : null;
    if (!name) continue;
    const walk = walkMinutes(r.walk_min);
    if (maxWalk !== undefined && walk !== null && walk > maxWalk) continue;
    const place: Place = {
      id: typeof r.id === "string" ? r.id : `r${places.length + 1}`,
      name,
      kind: typeof r.kind === "string" ? r.kind : "",
      walk_min: walk,
      price_level: priceLevel(r.price_level),
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string") : [],
      opens_until: clockTime(r.opens_until),
    };
    if (typeof r.source === "string") place.source = r.source;
    places.push(place);
  }
  return places;
}

/**
 * Widget props. The walking limit is echoed in the header only when every row states a walking time
 * (and so was checked against it); over rows of unknown distance it would read as a claim.
 */
export function restaurantProps(places: Place[], q: PlaceQuery): JsonObject {
  const props: JsonObject = { places };
  if (q.kind) props.kind = q.kind;
  if (q.max_walk_min !== undefined && places.length > 0 && places.every((p) => p.walk_min !== null)) props.max_walk_min = q.max_walk_min;
  return props;
}

/** Whole minutes as stated: 7, "7", "7 min", "7 minutes walk". Anything else (a range, a distance) is unknown. */
export function walkMinutes(v: JsonValue | undefined): number | null {
  let n = Number.NaN;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") {
    const m = /^(\d{1,3})\s*(?:min(?:ute)?s?\.?)?(?:\s*walk(?:ing)?)?$/i.exec(v.trim());
    if (m) n = Number(m[1]);
  }
  return Number.isInteger(n) && n > 0 && n <= MAX_WALK_MIN ? n : null;
}

/** 1..4, or the count of a result's currency signs ("€€" → 2). A range ("€€–€€€") is unknown. */
export function priceLevel(v: JsonValue | undefined): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= 1 && v <= 4 ? v : null;
  if (typeof v === "string") {
    const s = v.trim();
    if (/^(€{1,4}|\${1,4}|£{1,4})$/.test(s)) return s.length;
    if (/^[1-4]$/.test(s)) return Number(s);
  }
  return null;
}

/** "HH:mm" (24:00 allowed), padded; any other wording is unknown. */
export function clockTime(v: JsonValue | undefined): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min > 0)) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function num(v: JsonValue | undefined): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}
