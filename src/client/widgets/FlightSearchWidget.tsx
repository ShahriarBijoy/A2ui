import type { JsonObject, JsonValue } from "@shared/a2ui";
import type { Flight, FlightSearchWidgetProps } from "@shared/protocol";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { dayOffset, formatClock } from "@/format";

/**
 * Widgets mode (PLAN §3.8): a fixed flight search form plus result rows. No seat map and no way to add one
 * without shipping new code; asking for a seat falls back to plain text.
 */
export function FlightSearchWidget({ from, to, date, flights }: FlightSearchWidgetProps) {
  return (
    <article className="w-full max-w-[560px] rounded-xl border bg-card">
      <header className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h3 className="text-[1.0625rem] font-semibold tracking-tight">Flight search</h3>
        <Badge variant="outline" className="font-mono text-[0.6875rem] font-normal uppercase tracking-[0.08em] text-muted-foreground">
          demo data
        </Badge>
      </header>
      <div className="grid grid-cols-[1fr_1fr_1.2fr] gap-3 px-5 py-4">
        <Field label="From" value={from ?? ""} />
        <Field label="To" value={to ?? ""} />
        <Field label="Date" value={date ? formatDay(date) : ""} />
      </div>
      {flights.length === 0 ? (
        <p className="border-t px-5 py-4 text-[0.875rem] text-muted-foreground">No results yet.</p>
      ) : (
        <ul className="divide-y border-t">
          {flights.map((f) => {
            const plus = dayOffset(f.depart, f.arrive);
            return (
              <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-[0.9375rem] font-medium">{f.carrier}</p>
                  <p className="text-[0.8125rem] text-muted-foreground">
                    {f.from} → {f.to} · {f.stops === 0 ? "nonstop" : `${f.stops} stop${f.stops > 1 ? "s" : ""}`}
                  </p>
                </div>
                <p className="font-mono text-[0.875rem] tabular-nums">
                  {formatClock(f.depart)} – {formatClock(f.arrive)}
                  {plus > 0 && <sup className="ml-0.5 text-[0.625rem] text-muted-foreground">+{plus}</sup>}
                </p>
                <p className="w-[4.5rem] text-right font-mono text-[0.9375rem] font-medium tabular-nums">€{f.price_eur}</p>
              </li>
            );
          })}
        </ul>
      )}
    </article>
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

const str = (v: JsonValue | undefined): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: JsonValue | undefined): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function toFlight(v: JsonValue, i: number): Flight | null {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return null;
  const depart = str(v.depart);
  const arrive = str(v.arrive);
  const price = num(v.price_eur);
  if (!depart || !arrive || price === undefined) return null;
  return {
    id: str(v.id) ?? `f${i + 1}`,
    carrier: str(v.carrier) ?? "",
    from: str(v.from) ?? "",
    to: str(v.to) ?? "",
    depart,
    arrive,
    stops: num(v.stops) ?? 0,
    price_eur: price,
    demo: true,
  };
}

/** Widget props arrive as untyped JSON from the Worker; keep only well-formed records. */
export function parseFlightSearchProps(props: JsonObject): FlightSearchWidgetProps {
  const flights = Array.isArray(props.flights)
    ? props.flights.map(toFlight).filter((f): f is Flight => f !== null)
    : [];
  return { from: str(props.from), to: str(props.to), date: str(props.date), flights };
}
