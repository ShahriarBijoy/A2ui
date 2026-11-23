/**
 * Deterministic demo flights. The composer never invents flights or prices: a "flights" data line
 * is resolved here, and every record carries demo: true so the UI shows the "demo data" badge.
 */
import type { Flight } from "@shared/protocol";

const CARRIERS = ["Demo Air", "Hanse Demo", "Northwind Demo", "Blue Demo"] as const;
/** One departure window per option so the four flights spread over the day: [start hour, window hours]. */
const WINDOWS: readonly [number, number][] = [
  [6, 3],
  [10, 3],
  [14, 3],
  [18, 3],
];
/**
 * Rough nonstop minutes from northern Germany for destinations a speaker is likely to name on stage,
 * so "Bremen → New York" does not show a 3-hour flight. Anything else is treated as a European hop.
 */
const LONG_HAUL_MINUTES: Record<string, number> = {
  "new york": 525,
  nyc: 525,
  jfk: 525,
  boston: 500,
  chicago: 570,
  toronto: 510,
  "san francisco": 690,
  "los angeles": 700,
  dubai: 390,
  singapore: 750,
  tokyo: 780,
};
const PRICE_MIN = 89;
const PRICE_MAX = 640;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(value: string): boolean {
  const m = DATE_RE.exec(value);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === value;
}

/** Same from|to|date always gives the same four flights (rehearsal and stage must match). */
export function generateFlights(from: string, to: string, date: string): Flight[] {
  if (!isIsoDate(date)) throw new Error(`Bad flight date "${date}" (expected YYYY-MM-DD)`);
  const origin = from.trim();
  const destination = to.trim();
  const rand = mulberry32(hash32(`${origin.toLowerCase()}|${destination.toLowerCase()}|${date}`));
  // Route length is a property of the pair, so all four options share a base duration.
  const longHaul = LONG_HAUL_MINUTES[destination.toLowerCase()] ?? LONG_HAUL_MINUTES[origin.toLowerCase()];
  const baseMinutes = longHaul ?? 65 + Math.floor(rand() * 35) * 5;
  const carriers = shuffle([...CARRIERS], rand);
  const flights = WINDOWS.map(([startHour, windowHours], i): Flight => {
    const departMin = startHour * 60 + Math.floor(rand() * windowHours * 12) * 5;
    const stops = rand() < 0.4 ? 1 : 0;
    const layover = stops ? 45 + Math.floor(rand() * 20) * 5 : 0;
    const jitter = (Math.floor(rand() * 7) - 3) * 5;
    const duration = Math.max(45, baseMinutes + layover + jitter);
    const price = PRICE_MIN + Math.floor(rand() * (PRICE_MAX - PRICE_MIN + 1));
    return {
      id: `f${i + 1}`,
      carrier: carriers[i % carriers.length],
      from: origin,
      to: destination,
      depart: localDateTime(date, departMin),
      arrive: localDateTime(date, departMin + duration),
      stops,
      price_eur: price,
      demo: true,
    };
  });
  return flights;
}

/** "YYYY-MM-DD" + minutes after midnight → "YYYY-MM-DDTHH:mm" (UTC math, so no timezone drift). */
function localDateTime(date: string, minutes: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + minutes * 60_000);
  return t.toISOString().slice(0, 16);
}

/** FNV-1a, 32 bit. */
export function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
