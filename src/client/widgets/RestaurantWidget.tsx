import type { Place, RestaurantWidgetProps } from "@shared/protocol";
import { Badge } from "@/components/ui/badge";
import { placeRowParts } from "./restaurantRows";

export { parseRestaurantProps } from "./restaurantRows";

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
        <p className="px-5 py-6 text-[0.9375rem] text-muted-foreground">No places found.</p>
      ) : (
        <ul className="divide-y">
          {places.map((p) => (
            <PlaceRow key={p.id} place={p} />
          ))}
        </ul>
      )}
    </article>
  );
}

function PlaceRow({ place: p }: { place: Place }) {
  const { meta, price, walk, host } = placeRowParts(p);
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-3.5">
      <div className="min-w-0">
        <p className="truncate text-[0.9375rem] font-medium">{p.name}</p>
        {meta && <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{meta}</p>}
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
      <div className="flex max-w-[40%] shrink-0 flex-col items-end gap-0.5 text-right font-mono text-[0.8125rem] tabular-nums">
        {price && <p>{price}</p>}
        {walk && <p className="text-muted-foreground">{walk}</p>}
        {host && (
          <a
            href={p.source}
            target="_blank"
            rel="noopener noreferrer"
            title={p.source}
            className="max-w-full truncate text-[0.75rem] text-muted-foreground underline-offset-2 hover:underline"
          >
            {host}
          </a>
        )}
      </div>
    </li>
  );
}
