/**
 * Widgets mode's flight search on live data (owner decision 2026-11-24: no demo generator). show_flight_search
 * runs the same web search as a2ui data lines (search.ts validates the answer); this module turns the tool input
 * into that search and its records into the widget's rows. A web search finds route-level fare listings, not
 * departures, so a row is carrier · route · fare as listed. Nothing is computed or defaulted.
 */
import type { JsonObject, JsonValue } from "@shared/a2ui";
import type { Flight } from "@shared/protocol";
import { parseSearchArgs, type SearchRequest } from "./search";

export type FlightQuery = { from?: string; to?: string; date?: string };

/** The keys a row shows; search.ts carries a hint for each, and adds "source". */
export const FLIGHT_FIELDS: readonly string[] = ["carrier", "route", "price", "tags"];
export const FLIGHT_ITEMS = 4;
/** City names come from the person's words via the widgets model: keep them short phrases in the query. */
const MAX_PLACE_CHARS = 60;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** "2026-11-26" → "Thursday 26 November 2026", the form the composer's trip queries use. */
export function longDate(iso: string): string {
  if (!isIsoDate(iso)) return iso;
  const [y, m, d] = iso.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[day]} ${d} ${MONTHS[m - 1]} ${y}`;
}

export function flightQuery(input: JsonObject): FlightQuery {
  const q: FlightQuery = {};
  const from = place(input.from);
  const to = place(input.to);
  if (from) q.from = from;
  if (to) q.to = to;
  // A date-time ("2026-11-26T09:00") still names the day.
  const day = typeof input.date === "string" ? input.date.trim().slice(0, 10) : "";
  if (isIsoDate(day)) q.date = day;
  return q;
}

/**
 * "flights from <from> to <to> on <weekday d Month yyyy>". Null without both ends: a trip search needs them,
 * and nothing here guesses one. Without a date the query names none rather than assume one.
 */
export function flightSearch(q: FlightQuery): SearchRequest | null {
  if (!q.from || !q.to) return null;
  const when = q.date ? ` on ${longDate(q.date)}` : "";
  const parsed = parseSearchArgs({ query: `flights from ${q.from} to ${q.to}${when}`, fields: [...FLIGHT_FIELDS], max: FLIGHT_ITEMS });
  // Unreachable: the query always has text. Fail loudly rather than search for something else.
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.req;
}

/** Search records → widget rows. Rows without a carrier are dropped; unknown facts stay null. */
export function recordsToFlights(records: readonly JsonObject[]): Flight[] {
  const flights: Flight[] = [];
  for (const r of records) {
    const carrier = text(r.carrier);
    if (!carrier) continue;
    const flight: Flight = {
      id: typeof r.id === "string" ? r.id : `r${flights.length + 1}`,
      carrier,
      route: text(r.route),
      price: text(r.price),
      tags: Array.isArray(r.tags) ? r.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "") : typeof r.tags === "string" && r.tags.trim() ? [r.tags.trim()] : [],
    };
    if (typeof r.source === "string") flight.source = r.source;
    flights.push(flight);
  }
  return flights;
}

/** Widget props: the rows, and the form values the person gave. */
export function flightProps(flights: Flight[], q: FlightQuery): JsonObject {
  const props: JsonObject = { flights };
  if (q.from) props.from = q.from;
  if (q.to) props.to = q.to;
  if (q.date) props.date = q.date;
  return props;
}

function place(v: JsonValue | undefined): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim().replace(/\s+/g, " ").slice(0, MAX_PLACE_CHARS).trim();
  return s || undefined;
}

function text(v: JsonValue | undefined): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
}
