import { describe, expect, test } from "bun:test";
import { isIconName } from "@shared/icons";
import forecast from "./fixtures/open-meteo-forecast.json";
import geocoding from "./fixtures/open-meteo-geocoding.json";
import {
  fetchWeather,
  firstPlace,
  forecastUrl,
  geocodingUrl,
  parseWeatherArgs,
  shapeWeather,
  WEATHER_SOURCE_URL,
  wmoCondition,
  type FetchFn,
  type GeoPlace,
} from "./weather";

// Saved live answers (Open-Meteo, 2026-11-24 ~15:00 Europe/Berlin): Bremen, current.time "2026-11-24T15:00".
const bremen = firstPlace(geocoding) as GeoPlace;

describe("wmoCondition", () => {
  test("documented codes map to words and an icon from the icon set", () => {
    expect(wmoCondition(0)).toEqual({ condition: "Clear sky", icon: "sun" });
    expect(wmoCondition(1)).toEqual({ condition: "Mainly clear", icon: "sun" });
    expect(wmoCondition(2)).toEqual({ condition: "Partly cloudy", icon: "cloud" });
    expect(wmoCondition(3)).toEqual({ condition: "Overcast", icon: "cloud" });
    expect(wmoCondition(45)).toEqual({ condition: "Fog", icon: "cloud" });
    expect(wmoCondition(48)).toEqual({ condition: "Rime fog", icon: "cloud" });
    expect(wmoCondition(53)).toEqual({ condition: "Drizzle", icon: "umbrella" });
    expect(wmoCondition(61)).toEqual({ condition: "Light rain", icon: "rain" });
    expect(wmoCondition(67)).toEqual({ condition: "Freezing rain", icon: "rain" });
    expect(wmoCondition(75)).toEqual({ condition: "Heavy snow", icon: "snow" });
    expect(wmoCondition(81)).toEqual({ condition: "Showers", icon: "rain" });
    expect(wmoCondition(86)).toEqual({ condition: "Snow showers", icon: "snow" });
    expect(wmoCondition(95)).toEqual({ condition: "Thunderstorm", icon: "rain" });
    expect(wmoCondition(99)).toEqual({ condition: "Thunderstorm with hail", icon: "rain" });
  });

  test("every documented code has an icon in the set; an undocumented code in a group gets the group's words", () => {
    const documented = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
    for (const code of documented) {
      const c = wmoCondition(code);
      expect(c).not.toBeNull();
      expect(isIconName(c!.icon)).toBe(true);
    }
    expect(wmoCondition(97)).toEqual({ condition: "Thunderstorm", icon: "rain" });
    expect(wmoCondition(52)).toEqual({ condition: "Drizzle", icon: "umbrella" });
  });

  test("an unknown or missing code has no condition and no icon", () => {
    for (const code of [4, 30, 49, 90, 100, -1, 2.5, null, undefined, "3"]) expect(wmoCondition(code)).toBeNull();
  });
});

describe("parseWeatherArgs", () => {
  test("place is required; here/nearby is the venue's city; days 1-7, default 7", () => {
    expect(parseWeatherArgs({ place: "  Porto  " }, "Bremen")).toEqual({ ok: true, req: { place: "Porto", days: 7 } });
    expect(parseWeatherArgs({ place: "nearby" }, "Bremen")).toEqual({ ok: true, req: { place: "Bremen", days: 7 } });
    expect(parseWeatherArgs({ place: "Here" }, "Bremen")).toEqual({ ok: true, req: { place: "Bremen", days: 7 } });
    expect(parseWeatherArgs({ place: "Oslo", days: 3 }, "x")).toEqual({ ok: true, req: { place: "Oslo", days: 3 } });
    expect(parseWeatherArgs({ place: "Oslo", days: "2" }, "x")).toEqual({ ok: true, req: { place: "Oslo", days: 2 } });
    expect(parseWeatherArgs({ place: "Oslo", days: 40 }, "x")).toEqual({ ok: true, req: { place: "Oslo", days: 7 } });
    expect(parseWeatherArgs({ place: "Oslo", days: 0 }, "x")).toEqual({ ok: true, req: { place: "Oslo", days: 1 } });
    expect(parseWeatherArgs({ place: "Oslo", days: "soon" }, "x")).toEqual({ ok: true, req: { place: "Oslo", days: 7 } });
    expect(parseWeatherArgs({}, "Bremen")).toEqual({ ok: false, error: "weather: missing 'place'" });
    expect(parseWeatherArgs({ place: "   " }, "Bremen")).toEqual({ ok: false, error: "weather: missing 'place'" });
    expect(parseWeatherArgs({ place: "here" }, "")).toEqual({ ok: false, error: "weather: missing 'place'" });
  });
});

describe("shapeWeather (saved Open-Meteo answer)", () => {
  const record = shapeWeather(bremen, forecast)!;

  test("place label, update time, current conditions rounded (no -0)", () => {
    expect(record.place).toBe("Bremen, Germany");
    expect(record.updated).toBe("15:00");
    // -0.5 °C rounds to 0, never -0.
    expect(Object.is(record.now.temp, 0)).toBe(true);
    expect(record.now).toEqual({ temp: 0, feels: -3, humidity: 93, wind_kmh: 3, condition: "Fog", icon: "cloud" });
    expect(record.source).toBe(WEATHER_SOURCE_URL);
  });

  test("hours: 12 entries from the current local hour, crossing midnight, integer temperatures", () => {
    expect(record.hours).toHaveLength(12);
    expect(record.hours.map((h) => h.label)).toEqual(["15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00", "23:00", "00:00", "01:00", "02:00"]);
    expect(record.hours.map((h) => h.value)).toEqual([0, 0, -1, -2, -2, -2, -2, -2, -2, -2, -2, -3]);
    expect(record.hours.every((h) => !Object.is(h.value, -0))).toBe(true);
  });

  test("hours start at the hour of a quarter-hour current time", () => {
    const at = { ...forecast, current: { ...forecast.current, time: "2026-11-24T22:45" } };
    const r = shapeWeather(bremen, at)!;
    expect(r.updated).toBe("22:45");
    expect(r.hours[0].label).toBe("22:00");
    expect(r.hours).toHaveLength(12);
  });

  test("days: Today, then short weekdays from the date; min/max/rain rounded; condition and icon per day", () => {
    expect(record.days.map((d) => d.day)).toEqual(["Today", "Wed", "Thu", "Fri", "Sat", "Sun", "Mon"]);
    expect(record.days[0]).toEqual({ day: "Today", date: "2026-11-24", min: -4, max: 1, rain_pct: 0, condition: "Rime fog", icon: "cloud" });
    expect(record.days[5]).toEqual({ day: "Sun", date: "2026-11-29", min: -3, max: 2, rain_pct: 42, condition: "Light rain", icon: "rain" });
    expect(record.days[3]).toMatchObject({ min: -5, max: -1 });
  });

  test("days limits the list; a day other than the current date is never Today", () => {
    expect(shapeWeather(bremen, forecast, 3)!.days.map((d) => d.day)).toEqual(["Today", "Wed", "Thu"]);
    const tomorrow = { ...forecast, current: { ...forecast.current, time: "2026-11-23T23:30" } };
    expect(shapeWeather(bremen, tomorrow, 2)!.days.map((d) => d.day)).toEqual(["Tue", "Wed"]);
  });

  test("a value Open-Meteo leaves null stays null; an unknown code has no condition or icon", () => {
    const gaps = {
      ...forecast,
      current: { ...forecast.current, apparent_temperature: null, weather_code: 7 },
      daily: { ...forecast.daily, precipitation_probability_max: [null, 10] },
    };
    const r = shapeWeather({ ...bremen, country: null }, gaps)!;
    expect(r.place).toBe("Bremen");
    expect(r.now).toMatchObject({ feels: null, condition: null, icon: null });
    expect(r.days[0].rain_pct).toBeNull();
    expect(r.days[1].rain_pct).toBe(10);
    expect(r.days[2].rain_pct).toBeNull();
  });

  test("no current conditions → null", () => {
    expect(shapeWeather(bremen, { ...forecast, current: undefined })).toBeNull();
    expect(shapeWeather(bremen, { ...forecast, current: { ...forecast.current, time: "yesterday" } })).toBeNull();
    expect(shapeWeather(bremen, null)).toBeNull();
  });
});

describe("fetchWeather", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fake = (answers: Response[]) => {
    const urls: string[] = [];
    const fn: FetchFn = async (url) => {
      urls.push(url);
      const next = answers.shift();
      if (!next) throw new Error("unexpected request");
      return next;
    };
    return { fn, urls };
  };

  test("one geocoding request, then one forecast request for its coordinates", async () => {
    const { fn, urls } = fake([json(geocoding), json(forecast)]);
    const out = await fetchWeather({ place: "Bremen", days: 7 }, fn, new AbortController().signal);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.record).toEqual(shapeWeather(bremen, forecast)!);
    expect(urls).toEqual([geocodingUrl("Bremen"), forecastUrl(bremen)]);
    expect(urls[0]).toBe("https://geocoding-api.open-meteo.com/v1/search?name=Bremen&count=1&language=en&format=json");
    const q = new URL(urls[1]).searchParams;
    expect(q.get("latitude")).toBe("53.07582");
    expect(q.get("current")).toBe("temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code");
    expect(q.get("hourly")).toBe("temperature_2m,precipitation_probability,weather_code");
    expect(q.get("daily")).toBe("weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max");
    expect(q.get("timezone")).toBe("auto");
    expect(q.get("forecast_days")).toBe("7");
  });

  test("an unknown place (no results key) fails readably without a forecast request", async () => {
    const { fn, urls } = fake([json({ generationtime_ms: 0.05 })]);
    const out = await fetchWeather({ place: "Xqzzyplorbtown", days: 7 }, fn, new AbortController().signal);
    expect(out).toEqual({ ok: false, error: 'No place called "Xqzzyplorbtown" was found' });
    expect(urls).toHaveLength(1);
  });

  test("HTTP errors carry Open-Meteo's reason; a thrown fetch and an abort never reject", async () => {
    const bad = fake([json(geocoding), json({ error: true, reason: "Latitude must be in range of -90 to 90°. Given: 953.0." }, 400)]);
    expect(await fetchWeather({ place: "Bremen", days: 7 }, bad.fn, new AbortController().signal)).toEqual({
      ok: false,
      error: "forecast failed (HTTP 400: Latitude must be in range of -90 to 90°. Given: 953.0.)",
    });
    const down = fake([new Response("upstream", { status: 502 })]);
    expect(await fetchWeather({ place: "Bremen", days: 7 }, down.fn, new AbortController().signal)).toEqual({ ok: false, error: "place lookup failed (HTTP 502)" });
    const thrown: FetchFn = async () => {
      throw new Error("socket hang up");
    };
    expect(await fetchWeather({ place: "Bremen", days: 7 }, thrown, new AbortController().signal)).toEqual({ ok: false, error: "Open-Meteo unreachable: socket hang up" });
    const ctl = new AbortController();
    ctl.abort();
    const aborted: FetchFn = async (_u, init) => {
      if (init.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return json(geocoding);
    };
    expect(await fetchWeather({ place: "Bremen", days: 7 }, aborted, ctl.signal)).toEqual({ ok: false, error: "cancelled" });
  });

  test("a forecast without current conditions fails", async () => {
    const { fn } = fake([json(geocoding), json({ ...forecast, current: undefined })]);
    expect(await fetchWeather({ place: "Bremen", days: 7 }, fn, new AbortController().signal)).toEqual({ ok: false, error: "the forecast had no current conditions" });
  });
});
