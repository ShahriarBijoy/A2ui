/**
 * Scripted lines for rehearsal and the smoke test (PLAN §1.3, §8 step 13).
 * Every line here must work 10 times out of 10 in a2ui mode.
 */
import type { Mode } from "./protocol";

export type ScenarioStep =
  /** Something the speaker says (or types). */
  | { say: string; expect?: ScenarioExpect }
  /** Tap the first OptionCard / primary Button whose action name matches. */
  | { tap: string; expect?: ScenarioExpect };

export type ScenarioExpect = {
  /** Brick types that must appear in the turn's components. */
  bricks?: string[];
  /** The turn must be answered by the decision model alone (no LLM). */
  patchOnly?: boolean;
  /** Data paths that must hold these values after the turn. */
  data?: Record<string, unknown>;
};

export type Scenario = { id: string; title: string; group: "main" | "wildcard" | "contrast"; modes: Mode[]; steps: ScenarioStep[] };

export const SCENARIOS: readonly Scenario[] = [
  {
    id: "dinner",
    title: "Dinner after the event",
    group: "main",
    modes: ["a2ui", "widgets", "html"],
    steps: [
      { say: "I want dinner after this event, pick a place nearby.", expect: { bricks: ["OptionCard", "List"] } },
      { tap: "pick_place", expect: { bricks: ["Stepper", "ChoicePicker", "Button"] } },
      { say: "We're six, and later.", expect: { patchOnly: true } },
      { tap: "confirm" },
    ],
  },
  {
    id: "flight",
    title: "Flight tomorrow",
    group: "main",
    modes: ["a2ui", "widgets", "html"],
    steps: [
      { say: "I need to book a flight tomorrow.", expect: { bricks: ["TextField", "DateTimeInput"] } },
      { say: "To New York, give me options.", expect: { bricks: ["OptionCard"] } },
      { tap: "pick_flight", expect: { bricks: ["SeatMap"] } },
      { tap: "confirm" },
    ],
  },
  {
    id: "bill",
    title: "Bill split",
    group: "wildcard",
    modes: ["a2ui", "widgets", "html"],
    steps: [{ say: "Split a 120 euro bill between four, Jonas only had drinks." }],
  },
  {
    id: "packing",
    title: "Packing list",
    group: "wildcard",
    modes: ["a2ui", "widgets", "html"],
    steps: [{ say: "Packing list for New York in November." }],
  },
  {
    id: "quiz",
    title: "German quiz",
    group: "wildcard",
    modes: ["a2ui", "widgets", "html"],
    steps: [{ say: "Quiz me on five German A1 words." }],
  },
  {
    id: "pink",
    title: "Out-of-catalog request",
    group: "contrast",
    modes: ["a2ui", "html"],
    steps: [{ say: "Make the page pink and add a login box." }],
  },
];

/** Flat list of the first spoken line of every scenario, for quick smoke runs. */
export const OPENING_LINES: readonly string[] = SCENARIOS.flatMap((s) => {
  const first = s.steps[0];
  return first && "say" in first ? [first.say] : [];
});
