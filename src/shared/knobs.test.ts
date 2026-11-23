import { describe, expect, test } from "bun:test";
import type { CatalogComponent, JsonValue } from "./a2ui";
import { answersToRoute, buildRouteRequest, deriveKnobs, humanise, sliderStep } from "./knobs";
import type { JevAnswers } from "./knobs";
import type { Knob } from "./protocol";

// Monday 23 November 2026, local time (weekday checked: new Date(2026, 10, 28).getDay() === 6, a Saturday).
const NOW = new Date(2026, 10, 23, 12, 0);

const dinner: CatalogComponent[] = [
  { id: "title", component: "Text", text: "## Table" },
  {
    id: "time",
    component: "ChoicePicker",
    label: "Time",
    variant: "mutuallyExclusive",
    options: ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00"].map((t) => ({ label: t, value: t })),
    value: { "@path": "/booking/time" },
  },
  { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/booking/guests" } },
];
const dinnerData: JsonValue = { booking: { time: ["19:00"], guests: 4 } };

function choice(k: Knob) {
  if (k.type !== "choice") throw new Error("expected a choice knob, got " + k.type);
  return k;
}

describe("deriveKnobs", () => {
  test("dinner screen: time chips and guests stepper, current values excluded", () => {
    const knobs = deriveKnobs(dinner, dinnerData, NOW);
    expect(knobs.map((k) => k.id)).toEqual(["/booking/time", "/booking/guests"]);
    const time = choice(knobs[0]);
    expect(time.label).toBe("Time");
    expect(time.currentLabel).toBe("19:00");
    expect(time.options.map((o) => o.key)).toEqual(["18:00", "18:30", "19:30", "20:00", "20:30", "21:00"]);
    expect(time.options.find((o) => o.key === "20:00")?.value).toEqual(["20:00"]);
    const guests = choice(knobs[1]);
    expect(guests.component).toBe("Stepper");
    expect(guests.currentLabel).toBe("4");
    expect(guests.options).toHaveLength(11);
    expect(guests.options.some((o) => o.key === "4")).toBe(false);
    expect(guests.options.find((o) => o.key === "6")?.value).toBe(6);
  });

  test("stepper defaults to 1..20", () => {
    const [k] = deriveKnobs([{ id: "s", component: "Stepper", label: "Bags", value: { "@path": "/bags" } }], { bags: 2 }, NOW);
    const opts = choice(k).options.map((o) => o.value);
    expect(opts[0]).toBe(1);
    expect(opts[opts.length - 1]).toBe(20);
    expect(opts).toHaveLength(19);
  });

  test("slider: step size, 60-option cap keeps the values closest to the current one", () => {
    const [k] = deriveKnobs(
      [{ id: "b", component: "Slider", label: "Budget", min: 0, max: 1000, steps: 10, value: { "@path": "/budget" } }],
      { budget: 500 },
      NOW,
    );
    const values = choice(k).options.map((o) => o.value as number);
    expect(values).toHaveLength(60);
    expect(values).not.toContain(500);
    expect(Math.min(...values)).toBe(200);
    expect(Math.max(...values)).toBe(800);
  });

  test("slider steps larger than the range is a count", () => {
    expect(sliderStep(0, 1, 10)).toBeCloseTo(0.1);
    expect(sliderStep(0, 2000, 100)).toBe(100);
    expect(sliderStep(0, 50, undefined)).toBe(1);
    const [k] = deriveKnobs(
      [{ id: "o", component: "Slider", min: 0, max: 1, steps: 10, value: { "@path": "/mix/opacity" } }],
      { mix: { opacity: 0.3 } },
      NOW,
    );
    const c = choice(k);
    expect(c.label).toBe("Opacity");
    expect(c.options.map((o) => o.value)).toEqual([0, 0.1, 0.2, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
  });

  test("multipleSelection picker becomes a multi knob with every option", () => {
    const [k] = deriveKnobs(
      [
        {
          id: "diet",
          component: "ChoicePicker",
          label: "Diet",
          variant: "multipleSelection",
          options: [
            { label: "Vegan", value: "vegan" },
            { label: "Gluten free", value: "gf" },
          ],
          value: { "@path": "/diet" },
        },
      ],
      { diet: ["gf"] },
      NOW,
    );
    expect(k.type).toBe("multi");
    if (k.type !== "multi") return;
    expect(k.current).toEqual(["gf"]);
    expect(k.options.map((o) => o.key)).toEqual(["vegan", "gf"]);
  });

  test("checkbox becomes a bool knob", () => {
    const [k] = deriveKnobs(
      [{ id: "r", component: "CheckBox", label: "Return flight", value: { "@path": "/trip/return" } }],
      { trip: { return: false } },
      NOW,
    );
    expect(k).toMatchObject({ type: "bool", current: false, label: "Return flight", path: "/trip/return" });
  });

  test("time-only input: half-hour slots within ±6 h, labelled relative to the current value, current excluded", () => {
    const [k] = deriveKnobs(
      [{ id: "t", component: "DateTimeInput", label: "Time", enableTime: true, enableDate: false, value: { "@path": "/t" } }],
      { t: "19:00" },
      NOW,
    );
    const c = choice(k);
    const keys = c.options.map((o) => o.key);
    expect(keys[0]).toBe("13:00");
    // ±6 h wraps past midnight: 19:00 + 6 h = 01:00.
    expect(keys[keys.length - 1]).toBe("01:00");
    expect(keys).toHaveLength(24);
    expect(keys).not.toContain("19:00");
    expect(c.options.find((o) => o.key === "20:00")?.label).toBe("20:00 (1 h later)");
    expect(c.options.find((o) => o.key === "18:30")?.label).toBe("18:30 (30 min earlier)");
    expect(c.options.find((o) => o.key === "20:30")?.label).toBe("20:30 (1 h 30 min later)");
  });

  test("date-only input: today..+14 with weekday labels, current excluded", () => {
    const [k] = deriveKnobs(
      [{ id: "d", component: "DateTimeInput", label: "Date", enableDate: true, value: { "@path": "/flight/date" } }],
      { flight: { date: "2026-11-24" } },
      NOW,
    );
    const c = choice(k);
    expect(c.currentLabel).toBe("Tuesday 24 November 2026 (tomorrow)");
    expect(c.options).toHaveLength(14);
    expect(c.options[0]).toEqual({ key: "Mon 23 Nov", label: "Monday 23 November 2026 (today)", value: "2026-11-23" });
    expect(c.options.some((o) => o.value === "2026-11-24")).toBe(false);
    expect(c.options.find((o) => o.key === "Sat 28 Nov")).toEqual({
      key: "Sat 28 Nov",
      label: "Saturday 28 November 2026 (in 5 days)",
      value: "2026-11-28",
    });
    expect(c.options[c.options.length - 1].value).toBe("2026-12-07");
  });

  test("date mode inferred from the value when enableDate/enableTime are absent; date+time keeps the time", () => {
    const [k] = deriveKnobs(
      [{ id: "d", component: "DateTimeInput", value: { "@path": "/depart" } }],
      { depart: "2026-11-24T08:15" },
      NOW,
    );
    const c = choice(k);
    expect(c.label).toBe("Depart");
    expect(c.currentLabel).toBe("Tuesday 24 November 2026 (tomorrow), 08:15");
    expect(c.options.find((o) => o.key === "Wed 25 Nov")?.value).toBe("2026-11-25T08:15");
  });

  test("date+time input: date options keep the time, time slots keep the date and cross midnight", () => {
    const [k] = deriveKnobs(
      [{ id: "w", component: "DateTimeInput", label: "When", enableDate: true, enableTime: true, value: { "@path": "/when" } }],
      { when: "2026-11-25T23:00" },
      NOW,
    );
    const c = choice(k);
    expect(c.current).toBe("2026-11-25T23:00");
    expect(c.currentLabel).toBe("Wednesday 25 November 2026 (in 2 days), 23:00");
    expect(c.options.find((o) => o.key === "Fri 27 Nov")?.value).toBe("2026-11-27T23:00");
    expect(c.options.some((o) => o.key === "Wed 25 Nov")).toBe(false);
    expect(c.options.find((o) => o.key === "00:00")).toEqual({ key: "00:00", label: "00:00 (1 h later, next day)", value: "2026-11-26T00:00" });
    expect(c.options.find((o) => o.key === "17:00")?.value).toBe("2026-11-25T17:00");
    expect(c.options.some((o) => o.key === "23:00")).toBe(false);
  });

  test("seat map: free seats only, current and taken excluded, window/aisle labels", () => {
    const [k] = deriveKnobs(
      [{ id: "seat", component: "SeatMap", rows: 3, layout: "AB CD", taken: ["1A", "3D"], value: { "@path": "/seat" } }],
      { seat: "2C" },
      NOW,
    );
    const c = choice(k);
    const keys = c.options.map((o) => o.key);
    expect(keys).toHaveLength(9);
    expect(keys).not.toContain("1A");
    expect(keys).not.toContain("3D");
    expect(keys).not.toContain("2C");
    expect(c.options.find((o) => o.key === "1D")?.label).toBe("Row 1, seat D (window)");
    expect(c.options.find((o) => o.key === "1B")?.label).toBe("Row 1, seat B (aisle)");
    expect(c.options.find((o) => o.key === "12C")).toBeUndefined();
  });

  test("huge LLM-written ranges stay O(cap): 60 nearest numbers, 254 nearest seats, fast", () => {
    const t0 = performance.now();
    const [slider] = deriveKnobs(
      [{ id: "s", component: "Slider", label: "Budget", min: 0, max: 5_000_000_000, value: { "@path": "/b" } }],
      { b: 2_500_000 },
      NOW,
    );
    const [stepper] = deriveKnobs([{ id: "n", component: "Stepper", label: "N", min: 1, max: 1e12, value: { "@path": "/n" } }], { n: 7 }, NOW);
    const [seat] = deriveKnobs(
      [{ id: "seat", component: "SeatMap", rows: 10_000_000, layout: "ABC DEF", value: { "@path": "/seat" } }],
      { seat: "5000000C" },
      NOW,
    );
    const took = performance.now() - t0;
    const sv = choice(slider).options.map((o) => o.value as number);
    expect(sv).toHaveLength(60);
    expect(Math.min(...sv)).toBe(2_499_970);
    expect(Math.max(...sv)).toBe(2_500_030);
    expect(sv).not.toContain(2_500_000);
    const nv = choice(stepper).options.map((o) => o.value as number);
    expect(nv).toHaveLength(60);
    expect(nv[0]).toBe(1);
    expect(nv).not.toContain(7);
    const keys = choice(seat).options.map((o) => o.key);
    expect(keys).toHaveLength(254);
    expect(keys).toContain("5000000D");
    expect(keys).not.toContain("5000000C");
    expect(took).toBeLessThan(50);
  });

  test("a float current value is excluded even when it is not exactly on the grid", () => {
    const [k] = deriveKnobs(
      [{ id: "o", component: "Slider", min: 0, max: 1, steps: 10, value: { "@path": "/o" } }],
      { o: 0.1 + 0.2 },
      NOW,
    );
    expect(choice(k).options.map((o) => o.value)).not.toContain(0.3);
  });

  test("time-only input at 23:00: 'later' can reach 00:00 (wrap), and the hint names it", () => {
    const [k] = deriveKnobs(
      [{ id: "t", component: "DateTimeInput", label: "Time", enableTime: true, enableDate: false, value: { "@path": "/t" } }],
      { t: "23:00" },
      NOW,
    );
    const c = choice(k);
    expect(c.options.find((o) => o.key === "00:00")).toEqual({ key: "00:00", label: "00:00 (1 h later)", value: "00:00" });
    expect(c.options[0].key).toBe("17:00");
    expect(c.options[c.options.length - 1].key).toBe("05:00");
    const q = buildRouteRequest("we're six, and later", [k]).questions.k0;
    expect(q.instructions).toBe(
      "What should 'Time' be after this request? Current value: 23:00. If the speaker only says later without a time, pick 00:00 (one hour later). If the speaker only says earlier without a time, pick 22:00 (one hour earlier). A count of people, such as 'we're six', is not a time.",
    );
  });

  test("time-only input with no current value offers all 48 slots", () => {
    const [k] = deriveKnobs(
      [{ id: "t", component: "DateTimeInput", label: "Time", enableTime: true, enableDate: false, value: { "@path": "/t" } }],
      {},
      NOW,
    );
    const c = choice(k);
    expect(c.options).toHaveLength(48);
    expect(c.currentLabel).toBe("not set");
  });

  test("an option whose value is 'unchanged' (or a prototype key) is handled", () => {
    const [k] = deriveKnobs(
      [
        {
          id: "p",
          component: "ChoicePicker",
          label: "Pick",
          options: ["unchanged", "constructor", "toString", "a"].map((v) => ({ label: v, value: v })),
          value: { "@path": "/p" },
        },
      ],
      { p: ["a"] },
      NOW,
    );
    expect(choice(k).options.map((o) => o.key)).toEqual(["constructor", "toString"]);
    const { questions } = buildRouteRequest("x", [k]);
    const q = questions.k0;
    if (q.type !== "choice") throw new Error("k0 should be a choice");
    expect(Object.keys(q.criteria)).toEqual(["unchanged", "constructor", "toString"]);
  });

  test("seat map with a bound taken list and more than 254 free seats is capped", () => {
    const [k] = deriveKnobs(
      [{ id: "seat", component: "SeatMap", rows: 60, layout: "ABC DEF", taken: { "@path": "/taken" }, value: { "@path": "/seat" } }],
      { taken: ["30A"], seat: "30B" },
      NOW,
    );
    const keys = choice(k).options.map((o) => o.key);
    expect(keys.length).toBe(254);
    expect(keys).not.toContain("30A");
    expect(keys).toContain("30C");
  });

  test("TextField, relative bindings, literal values and non-inputs are not knobs", () => {
    const knobs = deriveKnobs(
      [
        { id: "from", component: "TextField", label: "From", value: { "@path": "/flight/from" } },
        { id: "rel", component: "Stepper", label: "Qty", value: { "@path": "qty" } },
        { id: "lit", component: "Stepper", label: "Lit", value: 3 },
        { id: "stat", component: "Stat", label: "Total", value: { "@path": "/total" } },
      ],
      { flight: { from: "Bremen" }, total: 5 },
      NOW,
    );
    expect(knobs).toEqual([]);
  });

  test("label falls back to the humanised last path token", () => {
    expect(humanise("returnFlight")).toBe("Return flight");
    expect(humanise("depart_date")).toBe("Depart date");
    const [k] = deriveKnobs(
      [{ id: "g", component: "Stepper", label: { "@path": "/l" }, value: { "@path": "/party/guestCount" } }],
      { party: { guestCount: 2 }, l: "x" },
      NOW,
    );
    expect(k.label).toBe("Guest count");
  });
});

describe("buildRouteRequest", () => {
  test("one kind question plus one question per knob, ids map back by index", () => {
    const knobs = deriveKnobs(dinner, dinnerData, NOW);
    const { state, questions } = buildRouteRequest("we're six, and later", knobs);
    expect(state).toEqual({ utterance: "we're six, and later", screen: { Time: "19:00", Guests: "4" } });
    expect(Object.keys(questions)).toEqual(["kind", "k0", "k1", "guard"]);
    const kind = questions.kind;
    expect(kind.type).toBe("choice");
    if (kind.type !== "choice") return;
    expect(Object.keys(kind.criteria)).toEqual(["edit", "new", "other"]);
    expect(kind.instructions).toContain("screen");
    expect(kind.criteria.new).toContain("confirming");
    const time = questions.k0;
    if (time.type !== "choice") throw new Error("k0 should be a choice");
    expect(time.instructions).toBe(
      "What should 'Time' be after this request? Current value: 19:00. If the speaker only says later without a time, pick 20:00 (one hour later). If the speaker only says earlier without a time, pick 18:00 (one hour earlier). A count of people, such as 'we're six', is not a time.",
    );
    expect(kind.instructions).toContain("Short follow-ups such as 'later'");
    expect(questions.guard).toEqual({
      type: "noul",
      instructions:
        "The only values that can change on this screen are: Time, Guests. Does the speaker also ask for something that is not one of these?",
      criteria: {
        true: "Part of the request is about something other than Time, Guests, such as a place, an extra item or another detail",
        false: "The whole request is about Time, Guests, or it changes nothing",
      },
    });
    expect(time.criteria.unchanged).toBe("No change asked for Time");
    expect(Object.keys(time.criteria)).not.toContain("19:00");
    const guests = questions.k1;
    if (guests.type !== "choice") throw new Error("k1 should be a choice");
    expect(guests.instructions).toStartWith("What should 'Guests' be after this request? Current value: 4.");
    expect(guests.instructions).toContain("A couple means two.");
    expect(Object.keys(guests.criteria)).toHaveLength(12);
  });

  test("time chips at the edge: one clause per direction, a sentinel where no option exists, never a cross-direction target", () => {
    const at = (cur: string) => {
      const q = buildRouteRequest("later", deriveKnobs(dinner, { booking: { time: [cur], guests: 4 } }, NOW)).questions.k0;
      if (q.type !== "choice") throw new Error("k0 should be a choice");
      return q;
    };
    const COUNT = " A count of people, such as 'we're six', is not a time.";
    const last = at("21:00");
    expect(last.instructions).toEndWith(
      "Current value: 21:00. If the speaker only says later, pick later. If the speaker only says earlier without a time, pick 20:00 (one hour earlier)." + COUNT,
    );
    expect(last.criteria.later).toBe("Later than 21:00, which is not available");
    expect(last.criteria.earlier).toBeUndefined();
    const first = at("18:00");
    expect(first.instructions).toEndWith(
      "Current value: 18:00. If the speaker only says later without a time, pick 19:00 (one hour later). If the speaker only says earlier, pick earlier." + COUNT,
    );
    expect(first.criteria.earlier).toBe("Earlier than 18:00, which is not available");
    // 20:30: a later chip exists (21:00) but not one hour later → no later clause, no sentinel.
    const nearEnd = at("20:30");
    expect(nearEnd.instructions).toEndWith("Current value: 20:30. If the speaker only says earlier without a time, pick 19:30 (one hour earlier)." + COUNT);
    expect(nearEnd.criteria.later).toBeUndefined();
    expect(Object.keys(buildRouteRequest("hello", []).questions)).toEqual(["kind"]);
  });

  test("date+time knob → a date question (k<i>) and a time question (k<i>t) over the same path", () => {
    const knobs = deriveKnobs(
      [{ id: "w", component: "DateTimeInput", label: "When", enableDate: true, enableTime: true, value: { "@path": "/when" } }],
      { when: "2026-11-25T19:00" },
      NOW,
    );
    const { questions } = buildRouteRequest("we're six, and later", knobs);
    expect(Object.keys(questions)).toEqual(["kind", "k0", "k0t", "guard"]);
    const date = questions.k0;
    const time = questions.k0t;
    if (date.type !== "choice" || time.type !== "choice") throw new Error("both parts should be choices");
    expect(date.instructions).toBe(
      "What should the date of 'When' be after this request? Current date: Wednesday 25 November 2026 (in 2 days). Only a named day changes the date (such as 'on Friday', 'tomorrow' or 'the day after'). If the speaker says the day after, pick Thu 26 Nov. Later, earlier or a time of day alone leave the date unchanged.",
    );
    expect(Object.keys(date.criteria).every((key) => !/^\d{2}:\d{2}$/.test(key))).toBe(true);
    expect(date.criteria.unchanged).toBe("No change asked for the date");
    expect(time.instructions).toBe(
      "What should the time of 'When' be after this request? Current time: 19:00. If the speaker only says later without a time, pick 20:00 (one hour later). If the speaker only says earlier without a time, pick 18:00 (one hour earlier). A count of people, such as 'we're six', is not a time. A day name alone (such as 'on Friday') leaves the time unchanged.",
    );
    expect(Object.keys(time.criteria).filter((key) => key !== "unchanged").every((key) => /^\d{2}:\d{2}$/.test(key))).toBe(true);
  });

  test("date+time answers combine into one patch: time only keeps the date, date only keeps the time, both, wrap, partial", () => {
    const comp: CatalogComponent[] = [
      { id: "w", component: "DateTimeInput", label: "When", enableDate: true, enableTime: true, value: { "@path": "/when" } },
    ];
    const at = (when: string) => deriveKnobs(comp, { when }, NOW);
    const k = (edit: number): JevAnswers[string] => ({ type: "choice", choice: "edit", confidence: 1, probabilities: { edit, new: 1 - edit, other: 0 } });
    const c = (probs: Record<string, number>): JevAnswers[string] => ({ type: "choice", choice: "x", confidence: 1, probabilities: probs });
    const g: JevAnswers[string] = { type: "noul", noul: 0.1 };
    const route = (when: string, date: Record<string, number>, time: Record<string, number>) =>
      answersToRoute({ kind: k(0.95), k0: c(date), k0t: c(time), guard: g }, at(when), 1, "jev");
    expect(route("2026-11-25T19:00", { unchanged: 0.98 }, { "20:00": 0.97, unchanged: 0.03 }).patches[0].value).toBe("2026-11-25T20:00");
    expect(route("2026-11-25T19:00", { "Fri 27 Nov": 0.99 }, { unchanged: 0.99 }).patches[0].value).toBe("2026-11-27T19:00");
    const both = route("2026-11-25T19:00", { "Fri 27 Nov": 0.97 }, { "21:00": 0.95 });
    expect(both.patches).toEqual([{ knobId: "/when", path: "/when", value: "2026-11-27T21:00", confidence: 0.95 }]);
    expect(both.reason).toBe("edit 0.95: When → Fri 27 Nov 21:00");
    expect(route("2026-11-25T23:00", { unchanged: 0.99 }, { "00:00": 0.99 }).patches[0].value).toBe("2026-11-26T00:00");
    const partial = route("2026-11-25T19:00", { unchanged: 0.2, "Fri 27 Nov": 0.4, "Sat 28 Nov": 0.4 }, { "21:00": 0.95 });
    expect(partial).toMatchObject({ decision: "compose", reason: "partial edit: When (date)" });
  });

  test("date knobs get the date relative-word hint", () => {
    const knobs = deriveKnobs(
      [{ id: "d", component: "DateTimeInput", label: "Date", enableDate: true, value: { "@path": "/d" } }],
      { d: "2026-11-24" },
      NOW,
    );
    const q = buildRouteRequest("the day after", knobs).questions.k0;
    expect(q.instructions).toEndWith(
      "If the speaker only says later, earlier or the day after without a date, pick one day after or before the current value.",
    );
  });

  test("multi knob → one noul per option; bool → one noul; duplicate labels get distinct screen keys", () => {
    const knobs: Knob[] = [
      {
        id: "/diet",
        componentId: "d",
        component: "ChoicePicker",
        path: "/diet",
        label: "Diet",
        type: "multi",
        current: ["gf"],
        options: [
          { key: "vegan", label: "Vegan", value: "vegan" },
          { key: "gf", label: "Gluten free", value: "gf" },
        ],
      },
      { id: "/a", componentId: "a", component: "CheckBox", path: "/a", label: "Diet", type: "bool", current: true },
    ];
    const { state, questions } = buildRouteRequest("vegan please", knobs);
    expect(state.screen).toEqual({ Diet: "Gluten free (options: Vegan, Gluten free)", "Diet (2)": "checked" });
    expect(Object.keys(questions)).toEqual(["kind", "k0_0", "k0_1", "k1", "guard"]);
    expect(questions.k0_0).toEqual({
      type: "noul",
      instructions: "Does the speaker ask to select 'Vegan'? It is currently not selected.",
      criteria: { true: "The speaker asks to select it", false: "Not mentioned, or something else is asked" },
    });
    expect(questions.k0_1.instructions).toBe("Does the speaker ask to deselect 'Gluten free'? It is currently selected.");
    expect(questions.k1.instructions).toBe("Does the speaker ask to uncheck 'Diet'? It is currently checked.");
  });
});

describe("answersToRoute", () => {
  const knobs = deriveKnobs(dinner, dinnerData, NOW);
  const kind = (edit: number, nw: number, other = 1 - edit - nw): JevAnswers["kind"] => ({
    type: "choice",
    choice: edit >= nw && edit >= other ? "edit" : nw >= other ? "new" : "other",
    confidence: 0.9,
    probabilities: { edit, new: nw, other },
  });
  const pick = (probs: Record<string, number>): JevAnswers[string] => {
    const choice = Object.entries(probs).sort((a, b) => b[1] - a[1])[0][0];
    return { type: "choice", choice, confidence: 0.9, probabilities: probs };
  };

  test("'we're six, and later' → patch guests 6 and time 20:00 (spike numbers)", () => {
    const r = answersToRoute(
      { kind: kind(0.98, 0.02), k0: pick({ unchanged: 0.05, "20:00": 0.91, "19:30": 0.04 }), k1: pick({ unchanged: 0.01, "6": 0.98, "5": 0.01 }) },
      knobs,
      180,
      "jev-1.14.0",
    );
    expect(r.decision).toBe("patch");
    expect(r.kind).toBe("edit");
    expect(r.kindConfidence).toBe(0.98);
    expect(r.ms).toBe(180);
    expect(r.engine).toBe("jev-1.14.0");
    expect(r.patches).toEqual([
      { knobId: "/booking/time", path: "/booking/time", value: ["20:00"], confidence: 0.91 },
      { knobId: "/booking/guests", path: "/booking/guests", value: 6, confidence: 0.98 },
    ]);
    expect(r.reason).toBe("edit 0.98: Time → 20:00, Guests → 6");
  });

  test("'book it' → compose", () => {
    const r = answersToRoute(
      { kind: kind(0, 1, 0), k0: pick({ unchanged: 1 }), k1: pick({ unchanged: 1 }) },
      knobs,
      150,
      "jev",
    );
    expect(r).toMatchObject({ decision: "compose", kind: "new", kindConfidence: 1, patches: [] });
    expect(r.reason).toBe("not an edit (new 1.00)");
  });

  test("partial edit (asked to change guests, no option clears 0.6) → compose even if time is clear", () => {
    const r = answersToRoute(
      { kind: kind(0.95, 0.05), k0: pick({ unchanged: 0.05, "20:00": 0.95 }), k1: pick({ unchanged: 0.2, "6": 0.4, "7": 0.4 }) },
      knobs,
      150,
      "jev",
    );
    expect(r.decision).toBe("compose");
    expect(r.patches).toEqual([]);
    expect(r.reason).toBe("partial edit: Guests");
  });

  test("a change as the top answer below 0.6 counts as partial too (stricter than P(unchanged) < 0.4)", () => {
    const r = answersToRoute(
      { kind: kind(0.95, 0.05), k0: pick({ unchanged: 0.05, "20:00": 0.95 }), k1: pick({ unchanged: 0.42, "6": 0.45, "7": 0.13 }) },
      knobs,
      150,
      "jev",
    );
    expect(r.reason).toBe("partial edit: Guests");
  });

  test("low kind confidence → compose", () => {
    const r = answersToRoute(
      { kind: kind(0.5, 0.3), k0: pick({ unchanged: 0.05, "20:00": 0.95 }), k1: pick({ unchanged: 1 }) },
      knobs,
      150,
      "jev",
    );
    expect(r).toMatchObject({ decision: "compose", kind: "edit", kindConfidence: 0.5 });
    expect(r.reason).toBe("unsure it is an edit (0.50)");
  });

  test("edit with every knob unchanged → compose", () => {
    const r = answersToRoute({ kind: kind(0.9, 0.1), k0: pick({ unchanged: 0.9, "20:00": 0.1 }), k1: pick({ unchanged: 0.8, "6": 0.2 }) }, knobs, 1, "jev");
    expect(r.decision).toBe("compose");
    expect(r.reason).toBe("edit, but no knob changed");
  });

  test("guard ≥ 0.5 → compose 'asks for something not on screen' even when a knob would patch; below → patch", () => {
    const answers = { kind: kind(0.93, 0.07), k0: pick({ unchanged: 1 }), k1: pick({ unchanged: 0.01, "6": 0.99 }) };
    const blocked = answersToRoute({ ...answers, guard: { type: "noul", noul: 0.91 } }, knobs, 1, "jev");
    expect(blocked).toMatchObject({ decision: "compose", kind: "edit", patches: [], reason: "asks for something not on screen" });
    const fine = answersToRoute({ ...answers, guard: { type: "noul", noul: 0.29 } }, knobs, 1, "jev");
    expect(fine.decision).toBe("patch");
    expect(fine.patches).toEqual([{ knobId: "/booking/guests", path: "/booking/guests", value: 6, confidence: 0.99 }]);
  });

  test("choosing the sentinel ('later' past the last chip) is a partial edit, never a patch", () => {
    const edge = deriveKnobs(dinner, { booking: { time: ["21:00"], guests: 4 } }, NOW);
    const r = answersToRoute(
      {
        kind: kind(0.95, 0.05),
        k0: pick({ later: 0.99, unchanged: 0.01, "20:00": 0 }),
        k1: pick({ unchanged: 0.01, "6": 0.99 }),
        guard: { type: "noul", noul: 0.2 },
      },
      edge,
      1,
      "jev",
    );
    expect(r).toMatchObject({ decision: "compose", patches: [], reason: "partial edit: Time (no later option)" });
  });

  test("kind 'other' → compose", () => {
    const r = answersToRoute({ kind: kind(0.01, 0.02, 0.97), k0: pick({ unchanged: 1 }), k1: pick({ unchanged: 1 }) }, knobs, 1, "jev");
    expect(r).toMatchObject({ decision: "compose", kind: "other", kindConfidence: 0.97, reason: "not an edit (other 0.97)" });
  });

  test("missing kind answer → compose", () => {
    expect(answersToRoute({}, knobs, 1, "jev").decision).toBe("compose");
  });

  const dietKnobs: Knob[] = [
    {
      id: "/diet",
      componentId: "d",
      component: "ChoicePicker",
      path: "/diet",
      label: "Diet",
      type: "multi",
      current: ["gf"],
      options: [
        { key: "vegan", label: "Vegan", value: "vegan" },
        { key: "gf", label: "Gluten free", value: "gf" },
        { key: "halal", label: "Halal", value: "halal" },
      ],
    },
    { id: "/ret", componentId: "r", component: "CheckBox", path: "/ret", label: "Return", type: "bool", current: false },
  ];
  const n = (noul: number): JevAnswers[string] => ({ type: "noul", noul });

  test("multi: nouls are P(flip); select vegan + deselect gluten free → one patch with the whole array", () => {
    const r = answersToRoute({ kind: kind(0.9, 0.1), k0_0: n(0.93), k0_1: n(0.91), k0_2: n(0.02), k1: n(0.03) }, dietKnobs, 1, "jev");
    expect(r.decision).toBe("patch");
    expect(r.patches).toEqual([{ knobId: "/diet", path: "/diet", value: ["vegan"], confidence: 0.91 }]);
  });

  test("bool flips at ≥ 0.6; an unsure noul (0.4..0.6) is a partial edit", () => {
    const r = answersToRoute({ kind: kind(0.9, 0.1), k0_0: n(0.02), k0_1: n(0.02), k0_2: n(0.02), k1: n(0.87) }, dietKnobs, 1, "jev");
    expect(r.patches).toEqual([{ knobId: "/ret", path: "/ret", value: true, confidence: 0.87 }]);
    const unsure = answersToRoute({ kind: kind(0.9, 0.1), k0_0: n(0.95), k0_1: n(0.02), k0_2: n(0.5), k1: n(0.02) }, dietKnobs, 1, "jev");
    expect(unsure).toMatchObject({ decision: "compose", reason: "partial edit: Diet: Halal" });
  });

  test("multi: adding an option keeps the existing selection; bool alongside", () => {
    const r = answersToRoute({ kind: kind(0.9, 0.1), k0_0: n(0.8), k0_1: n(0.1), k0_2: n(0.05), k1: n(0.7) }, dietKnobs, 1, "jev");
    expect(r.decision).toBe("patch");
    expect(r.patches).toEqual([
      { knobId: "/diet", path: "/diet", value: ["vegan", "gf"], confidence: 0.8 },
      { knobId: "/ret", path: "/ret", value: true, confidence: 0.7 },
    ]);
  });
});
