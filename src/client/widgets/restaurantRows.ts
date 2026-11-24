/**
 * RestaurantWidget's data side, kept out of the .tsx so it is testable under the test tsconfig.
 * Rows come from a live web search: a fact no result stated is null, and its part is left out.
 */
import type { JsonObject, JsonValue } from "@shared/a2ui";
import type { Place, RestaurantWidgetProps } from "@shared/protocol";
import { formatPriceLevel } from "@/format";
import { hostLabel, httpUrl } from "./sourceLink";

/** What one row shows; null parts are not rendered. */
export type PlaceRowParts = { meta: string; price: string | null; walk: string | null; host: string | null };

export function placeRowParts(p: Place): PlaceRowParts {
  return {
    meta: [p.kind, p.opens_until !== null ? `open until ${p.opens_until}` : ""].filter(Boolean).join(" · "),
    price: p.price_level !== null ? formatPriceLevel(p.price_level) : null,
    walk: p.walk_min !== null ? `${p.walk_min} min` : null,
    host: p.source ? hostLabel(p.source) : null,
  };
}

const str = (v: JsonValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: JsonValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function toPlace(v: JsonValue, i: number): Place | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const name = str(v.name);
  if (!name) return null;
  const walk = num(v.walk_min);
  const price = num(v.price_level);
  const opens = str(v.opens_until)?.trim();
  const place: Place = {
    id: str(v.id) ?? `place-${i}`,
    name,
    kind: str(v.kind) ?? "",
    // Unknown stays null: a default here would be a number nobody measured.
    walk_min: walk !== undefined && walk > 0 ? walk : null,
    price_level: price !== undefined && Number.isInteger(price) && price >= 1 && price <= 4 ? price : null,
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string") : [],
    opens_until: opens ? opens : null,
  };
  const source = httpUrl(v.source);
  if (source) place.source = source;
  return place;
}

/** Widget props arrive as untyped JSON from the Worker; keep only well-formed records. */
export function parseRestaurantProps(props: JsonObject): RestaurantWidgetProps {
  const places = Array.isArray(props.places)
    ? props.places.map(toPlace).filter((p): p is Place => p !== null)
    : [];
  return { places, kind: str(props.kind), max_walk_min: num(props.max_walk_min) };
}
