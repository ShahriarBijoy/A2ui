/**
 * Live weather for "weather" data lines (owner direction: real-world facts only from a live source).
 * Open-Meteo, no key: one geocoding request for the place, then one forecast request. The forecast is
 * shaped into one object for the screen; every number is Open-Meteo's, rounded to an integer, and a
 * value it does not give stays null. "Now" is the place's own local time as the forecast states it
 * (current.time), never the venue clock or DEV_NOW. Verified against the docs and live calls: NOTES.md.
 */
import { isPlainObject, type JsonObject, type JsonValue } from "@shared/a2ui";
import type { IconName } from "@shared/icons";

/** Both requests together; measured ~0.1-0.2 s each from Germany (NOTES.md). */
export const WEATHER_TIMEOUT_MS = 4_000;
/** Weather lines per turn (their own cap: they never take a search slot). */
export const MAX_WEATHER_PER_TURN = 3;
export const WEATHER_DAYS = 7;
export const WEATHER_HOURS = 12;
export const WEATHER_SOURCE_URL = "https://open-meteo.com/";
const GEOCODING_URL = "https://geocoding-api.open-meteo.com/v1/search";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const MAX_PLACE_CHARS = 100;
/** Words for "where the person is": the venue's city (STATE.city). */
const HERE = new Set(["here", "nearby", "near me", "around here", "near here"]);

export type WeatherRequest = { place: string; days: number };

export type WeatherNow = {
  temp: number | null;
  feels: number | null;
  humidity: number | null;
  wind_kmh: number | null;
  condition: string | null;
  icon: IconName | null;
};
export type WeatherHour = { label: string; value: number | null };
export type WeatherDay = {
  /** "Today" or a short weekday ("Wed"). */
  day: string;
  date: string;
  min: number | null;
  max: number | null;
  rain_pct: number | null;
  condition: string | null;
  icon: IconName | null;
};
/** What a weather line delivers to its "into" path. */
export type WeatherRecord = {
  place: string;
  /** Local "HH:mm" of the current conditions. */
  updated: string;
  now: WeatherNow;
  hours: WeatherHour[];
  days: WeatherDay[];
  source: string;
};

export type WeatherOutcome = { ok: true; record: WeatherRecord } | { ok: false; error: string };

export type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

// ── Args ──────────────────────────────────────────────────────────────────────

/** place (required; "here"/"nearby" → the venue's city), days? 1-7 (default 7). */
export function parseWeatherArgs(args: JsonObject, city: string): { ok: true; req: WeatherRequest } | { ok: false; error: string } {
  let place = typeof args.place === "string" ? args.place.trim().replace(/\s+/g, " ") : "";
  if (HERE.has(place.toLowerCase())) place = city.trim();
  if (!place) return { ok: false, error: "weather: missing 'place'" };
  const raw = typeof args.days === "string" ? Number(args.days) : args.days;
  const days = typeof raw === "number" && Number.isFinite(raw) ? Math.min(WEATHER_DAYS, Math.max(1, Math.round(raw))) : WEATHER_DAYS;
  return { ok: true, req: { place: place.slice(0, MAX_PLACE_CHARS), days } };
}

// ── WMO weather codes (Open-Meteo docs) ──────────────────────────────────────

const CONDITIONS: Readonly<Record<number, string>> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Light snow showers",
  86: "Snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

/** Code groups by range: an undocumented code inside a group gets the group's words. */
const GROUPS: readonly { from: number; to: number; condition: string; icon: IconName }[] = [
  { from: 0, to: 1, condition: "Clear", icon: "sun" },
  { from: 2, to: 3, condition: "Cloudy", icon: "cloud" },
  { from: 45, to: 48, condition: "Fog", icon: "cloud" },
  { from: 50, to: 59, condition: "Drizzle", icon: "umbrella" },
  { from: 60, to: 69, condition: "Rain", icon: "rain" },
  { from: 70, to: 79, condition: "Snow", icon: "snow" },
  { from: 80, to: 84, condition: "Showers", icon: "rain" },
  { from: 85, to: 86, condition: "Snow showers", icon: "snow" },
  { from: 95, to: 99, condition: "Thunderstorm", icon: "rain" },
];

/** Words and an icon (from ICON_NAMES) for a WMO weather code; an unknown code has neither. */
export function wmoCondition(code: unknown): { condition: string; icon: IconName } | null {
  if (typeof code !== "number" || !Number.isInteger(code)) return null;
  const group = GROUPS.find((g) => code >= g.from && code <= g.to);
  if (!group) return null;
  return { condition: CONDITIONS[code] ?? group.condition, icon: group.icon };
}

// ── Shaping (pure) ────────────────────────────────────────────────────────────

/** One geocoding result as the forecast request and the label need it. */
export type GeoPlace = { name: string; country: string | null; latitude: number; longitude: number };

/** The first result of a geocoding answer; null when there is none (Open-Meteo then omits "results"). */
export function firstPlace(body: unknown): GeoPlace | null {
  if (!isPlainObject(body) || !Array.isArray(body.results)) return null;
  const r: unknown = body.results[0];
  if (!isPlainObject(r) || typeof r.name !== "string" || !r.name.trim()) return null;
  if (typeof r.latitude !== "number" || typeof r.longitude !== "number" || !Number.isFinite(r.latitude) || !Number.isFinite(r.longitude)) return null;
  const country = typeof r.country === "string" && r.country.trim() ? r.country.trim() : null;
  return { name: r.name.trim(), country, latitude: r.latitude, longitude: r.longitude };
}

/** An integer, never -0; anything that is not a finite number is null (Open-Meteo leaves gaps as null). */
function round(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v) || 0 : null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function weekday(date: string): string | null {
  const m = DATE.exec(date);
  if (!m) return null;
  return WEEKDAYS[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
}

const at = (v: unknown, i: number): unknown => (Array.isArray(v) ? v[i] : undefined);

/**
 * The forecast as the screen reads it. hours: the next WEATHER_HOURS hourly temperatures from the current
 * local hour; days: the first `days` days, the first labelled "Today" when it is the current local date.
 * Null when the answer has no current conditions to anchor "now".
 */
export function shapeWeather(place: GeoPlace, forecast: unknown, days: number = WEATHER_DAYS): WeatherRecord | null {
  if (!isPlainObject(forecast) || !isPlainObject(forecast.current)) return null;
  const current = forecast.current;
  const now = typeof current.time === "string" ? LOCAL_TIME.exec(current.time) : null;
  if (!now) return null;
  const today = now[1];
  const hourKey = `${today}T${now[2]}:00`;
  const label = place.country ? `${place.name}, ${place.country}` : place.name;
  const cond = wmoCondition(current.weather_code);

  const hours: WeatherHour[] = [];
  const hourly = isPlainObject(forecast.hourly) ? forecast.hourly : null;
  const hourTimes = Array.isArray(hourly?.time) ? hourly.time : [];
  // ISO local times compare as strings; the first hour at or after the current one starts the list.
  const start = hourTimes.findIndex((t) => typeof t === "string" && t >= hourKey);
  if (start >= 0) {
    for (let i = start; i < hourTimes.length && hours.length < WEATHER_HOURS; i++) {
      const t = hourTimes[i];
      if (typeof t !== "string" || !LOCAL_TIME.test(t)) continue;
      hours.push({ label: t.slice(11, 16), value: round(at(hourly?.temperature_2m, i)) });
    }
  }

  const out: WeatherDay[] = [];
  const daily = isPlainObject(forecast.daily) ? forecast.daily : null;
  const dayTimes = Array.isArray(daily?.time) ? daily.time : [];
  for (let i = 0; i < dayTimes.length && out.length < days; i++) {
    const date = dayTimes[i];
    if (typeof date !== "string") continue;
    const name = date === today ? "Today" : weekday(date);
    if (!name) continue;
    const c = wmoCondition(at(daily?.weather_code, i));
    out.push({
      day: name,
      date,
      min: round(at(daily?.temperature_2m_min, i)),
      max: round(at(daily?.temperature_2m_max, i)),
      rain_pct: round(at(daily?.precipitation_probability_max, i)),
      condition: c?.condition ?? null,
      icon: c?.icon ?? null,
    });
  }

  return {
    place: label,
    updated: `${now[2]}:${now[3]}`,
    now: {
      temp: round(current.temperature_2m),
      feels: round(current.apparent_temperature),
      humidity: round(current.relative_humidity_2m),
      wind_kmh: round(current.wind_speed_10m),
      condition: cond?.condition ?? null,
      icon: cond?.icon ?? null,
    },
    hours,
    days: out,
    source: WEATHER_SOURCE_URL,
  };
}

// ── Requests ──────────────────────────────────────────────────────────────────

export function geocodingUrl(place: string): string {
  const q = new URLSearchParams({ name: place, count: "1", language: "en", format: "json" });
  return `${GEOCODING_URL}?${q}`;
}

export function forecastUrl(p: GeoPlace): string {
  const q = new URLSearchParams({
    latitude: String(p.latitude),
    longitude: String(p.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code",
    hourly: "temperature_2m,precipitation_probability,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max",
    timezone: "auto",
    // Always 7: with fewer days an evening request runs out of hours for the next 12.
    forecast_days: String(WEATHER_DAYS),
  });
  return `${FORECAST_URL}?${q}`;
}

type JsonReply = { ok: true; body: JsonValue } | { ok: false; error: string };

/** GET as JSON. An HTTP error carries Open-Meteo's own reason ({"error":true,"reason":...}) when it sent one. */
async function getJson(fetchFn: FetchFn, url: string, signal: AbortSignal): Promise<JsonReply> {
  const res = await fetchFn(url, { signal, headers: { accept: "application/json" } });
  let body: JsonValue = null;
  try {
    body = (await res.json()) as JsonValue;
  } catch {
    if (res.ok) return { ok: false, error: "answer was not JSON" };
  }
  if (!res.ok) {
    const reason = isPlainObject(body) && typeof body.reason === "string" ? `: ${body.reason}` : "";
    return { ok: false, error: `HTTP ${res.status}${reason}` };
  }
  return { ok: true, body };
}

/**
 * One geocoding request, then one forecast request. Never throws: an unknown place, an HTTP error, a
 * malformed answer or the signal ending all become { ok: false, error } with a readable reason.
 */
export async function fetchWeather(req: WeatherRequest, fetchFn: FetchFn, signal: AbortSignal): Promise<WeatherOutcome> {
  try {
    const geo = await getJson(fetchFn, geocodingUrl(req.place), signal);
    if (!geo.ok) return { ok: false, error: `place lookup failed (${geo.error})` };
    const place = firstPlace(geo.body);
    if (!place) return { ok: false, error: `No place called "${req.place}" was found` };
    const forecast = await getJson(fetchFn, forecastUrl(place), signal);
    if (!forecast.ok) return { ok: false, error: `forecast failed (${forecast.error})` };
    const record = shapeWeather(place, forecast.body, req.days);
    return record ? { ok: true, record } : { ok: false, error: "the forecast had no current conditions" };
  } catch (err) {
    if (signal.aborted) return { ok: false, error: "cancelled" };
    return { ok: false, error: `Open-Meteo unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }
}
