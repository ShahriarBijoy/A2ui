import type { Flight, FlightSearchWidgetProps } from "@shared/protocol";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { emptyFlightsText, flightRowParts } from "./flightRows";

export { parseFlightSearchProps } from "./flightRows";

/**
 * Widgets mode (PLAN §3.8): a fixed flight search form plus rows from a live web search (carrier, route and the
 * fare as a result lists it). No seat map and no way to add one without shipping new code; asking for a seat
 * falls back to plain text.
 */
export function FlightSearchWidget({ from, to, date, flights }: FlightSearchWidgetProps) {
  return (
    <article className="w-full max-w-[560px] rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h3 className="text-[1.0625rem] font-semibold tracking-tight">Flight search</h3>
        <Badge variant="outline" className="font-mono text-[0.6875rem] font-normal uppercase tracking-[0.08em] text-muted-foreground">
          web results
        </Badge>
      </header>
      <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-3 px-5 py-4">
        <Field label="From" value={from ?? ""} />
        <Field label="To" value={to ?? ""} />
        <Field label="Date" value={date ? formatDay(date) : ""} />
      </div>
      {flights.length === 0 ? (
        <p className="border-t px-5 py-4 text-[0.875rem] text-muted-foreground">{emptyFlightsText({ from, to })}</p>
      ) : (
        <ul className="divide-y border-t">
          {flights.map((f) => (
            <FlightRow key={f.id} flight={f} />
          ))}
        </ul>
      )}
    </article>
  );
}

function FlightRow({ flight: f }: { flight: Flight }) {
  const { route, price, tags, host } = flightRowParts(f);
  return (
    <li className="flex items-start justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className="truncate text-[0.9375rem] font-medium">{f.carrier}</p>
        {route && <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{route}</p>}
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <Badge key={t} variant="outline" className="font-normal text-muted-foreground">
                {t}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="flex max-w-[40%] shrink-0 flex-col items-end gap-0.5 text-right">
        {price && <p className="font-mono text-[0.9375rem] font-medium tabular-nums">{price}</p>}
        {host && (
          <a
            href={f.source}
            target="_blank"
            rel="noopener noreferrer"
            title={f.source}
            className="max-w-full truncate font-mono text-[0.75rem] text-muted-foreground underline-offset-2 hover:underline"
          >
            {host}
          </a>
        )}
      </div>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[0.75rem] font-medium text-muted-foreground">{label}</span>
      <Input readOnly value={value} placeholder="—" className="h-9 bg-background text-[0.9375rem] md:text-[0.9375rem]" />
    </label>
  );
}

function formatDay(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
