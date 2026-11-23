import { describe, expect, test } from "bun:test";
import type { CatalogComponent, JsonValue } from "@shared/a2ui";
import { deriveKnobs } from "@shared/knobs";
import { setAt } from "@shared/pointer";
import { PATCH_EXPECT, changedLeaves, checkPatchOutcome, countControl, parseTime, planPatch, timeControls } from "./smoke";

// The talk clock (DEV_NOW); date knobs list today..today+14 from it.
const NOW = new Date(2026, 10, 25, 18, 45);
const SIX_LATER = PATCH_EXPECT["We're six, and later."];

const guests: CatalogComponent = { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/dinner/guests" } };
const time: CatalogComponent = { id: "time", component: "DateTimeInput", label: "Time", enableDate: false, enableTime: true, value: { "@path": "/dinner/time" } };
const when: CatalogComponent = { id: "when", component: "DateTimeInput", label: "When", enableDate: true, enableTime: true, value: { "@path": "/dinner/when" } };
const day: CatalogComponent = { id: "day", component: "DateTimeInput", label: "Day", enableDate: true, value: { "@path": "/dinner/day" } };
const chips: CatalogComponent = {
  id: "time",
  component: "ChoicePicker",
  label: "Time",
  variant: "mutuallyExclusive",
  options: ["19:00", "20:00", "21:00"].map((v) => ({ label: v, value: v })),
  value: { "@path": "/dinner/time" },
};
const note: CatalogComponent = { id: "note", component: "TextField", label: "Note", value: { "@path": "/dinner/note" } };

function check(components: CatalogComponent[], before: JsonValue, patches: Record<string, JsonValue>) {
  let after = before;
  for (const [path, value] of Object.entries(patches)) after = setAt(after, path, value);
  return checkPatchOutcome(deriveKnobs(components, before, NOW), before, after, SIX_LATER);
}

describe("parseTime", () => {
  test("reads time, ChoicePicker selection and date+time; anything else is unset", () => {
    expect(parseTime("19:30")).toEqual({ date: null, minutes: 1170 });
    expect(parseTime(["20:00"])).toEqual({ date: null, minutes: 1200 });
    expect(parseTime("2026-11-25T19:30")).toEqual({ date: "2026-11-25", minutes: 1170 });
    expect(parseTime("2026-11-25")).toBeNull();
    expect(parseTime([])).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });
});

describe("controls", () => {
  test("a date-only DateTimeInput is not a time control; time-only, date+time and HH:mm chips are", () => {
    const data = { dinner: { day: "2026-11-25", time: "19:30", when: "2026-11-25T19:30", guests: 2 } };
    const labels = timeControls(deriveKnobs([day, time, when, guests], data, NOW)).map((k) => k.label);
    expect(labels).toEqual(["Time", "When"]);
    expect(timeControls(deriveKnobs([chips], { dinner: { time: ["19:00"] } }, NOW)).map((k) => k.label)).toEqual(["Time"]);
  });

  test("the count prefers the Stepper labelled for people", () => {
    const nights: CatalogComponent = { id: "nights", component: "Stepper", label: "Nights", value: { "@path": "/stay/nights" } };
    const knobs = deriveKnobs([nights, guests], { stay: { nights: 2 }, dinner: { guests: 2 } }, NOW);
    expect(countControl(knobs)?.path).toBe("/dinner/guests");
  });
});

describe("planPatch", () => {
  test("patch when the screen holds a count and a later time", () => {
    const plan = planPatch(deriveKnobs([time, guests], { dinner: { time: "19:00", guests: 2 } }, NOW), SIX_LATER);
    expect(plan.expected).toBe("patch");
  });

  test("compose on a Guests-only screen, after the last chip, or when the time has no value", () => {
    const only = planPatch(deriveKnobs([guests], { dinner: { guests: 2 } }, NOW), SIX_LATER);
    expect(only).toMatchObject({ expected: "compose", why: "no time control on screen" });
    const last = planPatch(deriveKnobs([chips, guests], { dinner: { time: ["21:00"], guests: 2 } }, NOW), SIX_LATER);
    expect(last).toMatchObject({ expected: "compose", why: "no later time on the same date" });
    const unset = planPatch(deriveKnobs([time, guests], { dinner: { guests: 2 } }, NOW), SIX_LATER);
    expect(unset).toMatchObject({ expected: "compose", dropped: "later" });
  });

  test("compose when the count cannot reach six", () => {
    const small: CatalogComponent = { ...guests, max: 4 } as CatalogComponent;
    expect(planPatch(deriveKnobs([time, small], { dinner: { time: "19:00", guests: 2 } }, NOW), SIX_LATER).expected).toBe("compose");
  });
});

describe("checkPatchOutcome", () => {
  test("passes: Guests 2 → 6, Time 19:00 → 20:00 (smoke run shape)", () => {
    const r = check([time, guests], { dinner: { time: "19:00", guests: 2 } }, { "/dinner/time": "20:00", "/dinner/guests": 6 });
    expect(r.reasons).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.values).toEqual(['Guests /dinner/guests: 2 → 6', 'Time /dinner/time: "19:00" → "20:00" (+60 min, same date)']);
  });

  test("passes: date+time later on the same date, and HH:mm chips", () => {
    expect(check([when, guests], { dinner: { when: "2026-11-25T19:30", guests: 2 } }, { "/dinner/when": "2026-11-25T20:30", "/dinner/guests": 6 }).ok).toBe(true);
    expect(check([chips, guests], { dinner: { time: ["19:00"], guests: 2 } }, { "/dinner/time": ["20:00"], "/dinner/guests": 6 }).ok).toBe(true);
  });

  test("fails: date+time moved to the next day at the same time (smoke run shape: When → Thu 26 Nov)", () => {
    const r = check([when, guests], { dinner: { when: "2026-11-25T19:30", guests: 2 } }, { "/dinner/when": "2026-11-26T19:30", "/dinner/guests": 6 });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(["When moved to another date (2026-11-25 → 2026-11-26)"]);
  });

  test("fails: a separate Day moved and the Time stayed", () => {
    const r = check([day, time, guests], { dinner: { day: "2026-11-25", time: "19:30", guests: 2 } }, { "/dinner/day": "2026-11-26", "/dinner/guests": 6 });
    expect(r.reasons).toEqual(["later dropped: Time unchanged", "other values changed: /dinner/day"]);
  });

  test("fails: Guests patched, later dropped", () => {
    const r = check([time, guests], { dinner: { time: "19:00", guests: 2 } }, { "/dinner/guests": 6 });
    expect(r.reasons).toEqual(["later dropped: Time unchanged"]);
  });

  test("fails: any patch on a screen with no time control", () => {
    const r = check([guests], { dinner: { guests: 2 } }, { "/dinner/guests": 6 });
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(["later dropped: patched although no time control on screen (expected compose)"]);
    expect(r.values).toEqual(["/dinner/guests: 2 → 6"]);
  });

  test("fails: wrong count, earlier time, or another value changed", () => {
    const base = { dinner: { time: "19:00", guests: 2, note: "" } };
    expect(check([time, guests], base, { "/dinner/time": "20:00", "/dinner/guests": 5 }).reasons).toEqual(["Guests is 5, expected 6"]);
    expect(check([time, guests], base, { "/dinner/time": "18:00", "/dinner/guests": 6 }).reasons).toEqual(["Time is not later (19:00 → 18:00)"]);
    const other = check([time, guests, note], base, { "/dinner/time": "20:00", "/dinner/guests": 6, "/dinner/note": "x" });
    expect(other.reasons).toEqual(["other values changed: /dinner/note"]);
  });

  test("guests already six: only the time has to move", () => {
    expect(check([time, guests], { dinner: { time: "19:00", guests: 6 } }, { "/dinner/time": "20:00" }).ok).toBe(true);
  });
});

describe("changedLeaves", () => {
  test("leaf pointers for nested objects and arrays, escaped", () => {
    expect(changedLeaves({ a: { b: 1, c: [1, 2] }, "x/y": 1 }, { a: { b: 1, c: [1, 3, 4] }, "x/y": 2 })).toEqual(["/a/c/1", "/a/c/2", "/x~1y"]);
    expect(changedLeaves({ a: 1 }, { a: 1 })).toEqual([]);
    expect(changedLeaves(1, 2)).toEqual(["/"]);
  });
});
