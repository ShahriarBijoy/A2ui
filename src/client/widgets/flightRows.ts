/**
 * FlightSearchWidget's data side, kept out of the .tsx so it is testable under the test tsconfig.
 * Rows come from a live web search: route-level fare listings, so a row is carrier · route · fare as a result
 * lists it, with tags that say what the fare is. A fact no result stated is null, and its part is left out.
 */
import type { JsonObject, JsonValue } from "@shared/a2ui";
import type { Flight, FlightSearchWidgetProps } from "@shared/protocol";
import { hostLabel, httpUrl } from "./sourceLink";

/** What one row shows besides the carrier; null parts are not rendered. */
export type FlightRowParts = { route: string | null; price: string | null; tags: string[]; host: string | null };

export function flightRowParts(f: Flight): FlightRowParts {
  return { route: f.route, price: f.price, tags: f.tags.slice(0, 3), host: f.source ? hostLabel(f.source) : null };
}

/**
 * Neutral once a search could run (both ends known): the props do not say whether it found nothing or failed.
 * Before that nothing was looked up.
 */
export function emptyFlightsText(props: Pick<FlightSearchWidgetProps, "from" | "to">): string {
  return props.from && props.to ? "No flights to show." : "No results yet.";
}

const str = (v: JsonValue | undefined): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function toFlight(v: JsonValue, i: number): Flight | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const carrier = str(v.carrier);
  if (!carrier) return null;
  const flight: Flight = {
    id: str(v.id) ?? `flight-${i}`,
    carrier,
    route: str(v.route),
    price: str(v.price),
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string" && t.trim() !== "") : [],
  };
  const source = httpUrl(v.source);
  if (source) flight.source = source;
  return flight;
}

/** Widget props arrive as untyped JSON from the Worker; keep only rows that name a carrier. */
export function parseFlightSearchProps(props: JsonObject): FlightSearchWidgetProps {
  const flights = Array.isArray(props.flights) ? props.flights.map(toFlight).filter((f): f is Flight => f !== null) : [];
  return { from: str(props.from) ?? undefined, to: str(props.to) ?? undefined, date: str(props.date) ?? undefined, flights };
}
