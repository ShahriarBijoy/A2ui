import type { JsonObject, JsonValue } from "@shared/a2ui";
import type { Place, RestaurantWidgetProps } from "@shared/protocol";
import { Badge } from "@/components/ui/badge";
import { formatPriceLevel } from "@/format";

/**
 * Widgets mode (PLAN §3.8): an ordinary, hand-written restaurant list. Deliberately closed: no booking,
 * no follow-up step. The gap is the point of the comparison.
 */
export function RestaurantWidget({ places, kind, max_walk_min }: RestaurantWidgetProps) {
  const filters = [kind, max_walk_min !== undefined ? `≤ ${max_walk_min} min walk` : undefined].filter(Boolean).join(" · ");
  return (
    <article className="w-full max-w-[560px] rounded-xl border bg-card">
      <header className="flex items-baseline justify-between gap-3 border-b px-5 py-3.5">
        <h3 className="text-[1.0625rem] font-semibold tracking-tight">Restaurants nearby</h3>
        {filters && <span className="truncate text-[0.8125rem] text-muted-foreground">{filters}</span>}
      </header>
      {places.length === 0 ? (
        <p className="px-5 py-6 text-[0.9375rem] text-muted-foreground">No places match.</p>
      ) : (
        <ul className="divide-y">
          {places.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-4 px-5 py-3.5">
              <div className="min-w-0">
                <p className="truncate text-[0.9375rem] font-medium">{p.name}</p>
                <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">
                  {p.kind}
                  {p.opens_until && <> · open until {p.opens_until}</>}
                </p>
                {p.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {p.tags.slice(0, 3).map((t) => (
                      <Badge key={t} variant="outline" className="font-normal text-muted-foreground">
                        {t}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div className="shrink-0 text-right font-mono text-[0.8125rem] tabular-nums">
                <p>{formatPriceLevel(p.price_level)}</p>
                <p className="mt-0.5 text-muted-foreground">{p.walk_min} min</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

const str = (v: JsonValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: JsonValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function toPlace(v: JsonValue, i: number): Place | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const name = str(v.name);
  if (!name) return null;
  return {
    id: str(v.id) ?? `place-${i}`,
    name,
    kind: str(v.kind) ?? "",
    walk_min: num(v.walk_min) ?? 0,
    price_level: num(v.price_level) ?? 1,
    tags: Array.isArray(v.tags) ? v.tags.filter((t): t is string => typeof t === "string") : [],
    opens_until: str(v.opens_until) ?? "",
  };
}

/** Widget props arrive as untyped JSON from the Worker; keep only well-formed records. */
export function parseRestaurantProps(props: JsonObject): RestaurantWidgetProps {
  const places = Array.isArray(props.places)
    ? props.places.map(toPlace).filter((p): p is Place => p !== null)
    : [];
  return { places, kind: str(props.kind), max_walk_min: num(props.max_walk_min) };
}
