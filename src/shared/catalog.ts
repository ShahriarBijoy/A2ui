/**
 * The brick pool: every component the agent may use. Single source for
 * the pool UI, the composer prompt, validation, and Jev brick prediction.
 * Contract file: change only with the controller's agreement.
 */
import type { ComponentType } from "./a2ui";

export type BrickName = ComponentType;
export type BrickGroup = "layout" | "content" | "input" | "custom";

export type BrickDef = {
  name: BrickName;
  /** Label on the pool tile. */
  poolLabel: string;
  group: BrickGroup;
  /** Not part of the A2UI basic catalog; defined by Brick Box. */
  custom: boolean;
  /** One line: what it is for. Used in the composer prompt. */
  purpose: string;
  /** Prop signature for the composer prompt. */
  props: string;
  /** Plain-language description for the Jev prediction question. */
  predictHint: string;
};

export const CATALOG_PATH = "/catalog/brick-box/v1";

export const BRICKS: readonly BrickDef[] = [
  {
    name: "Text",
    poolLabel: "Text",
    group: "content",
    custom: false,
    purpose: "Headings and short text. Markdown subset: #, ##, ###, **bold**.",
    props: 'text, variant?: "body"|"caption"',
    predictHint: "a line of text or a heading",
  },
  {
    name: "Card",
    poolLabel: "Card",
    group: "layout",
    custom: false,
    purpose: "A bordered box around one child.",
    props: "child (id)",
    predictHint: "a bordered card that groups content",
  },
  {
    name: "Row",
    poolLabel: "Row",
    group: "layout",
    custom: false,
    purpose: "Children side by side.",
    props: 'children (ids), justify?: "start"|"center"|"end"|"spaceBetween", align?: "start"|"center"|"end"',
    predictHint: "items laid out side by side",
  },
  {
    name: "Column",
    poolLabel: "Column",
    group: "layout",
    custom: false,
    purpose: "Children stacked top to bottom.",
    props: 'children (ids), align?: "start"|"center"|"end"|"stretch"',
    predictHint: "items stacked vertically",
  },
  {
    name: "List",
    poolLabel: "List",
    group: "layout",
    custom: false,
    purpose: "Repeats a template for each item of a data array.",
    props: 'children: ids or {"path":"/pointer","componentId":"<template id>"}, direction?: "vertical"|"horizontal"',
    predictHint: "a list of several similar items, such as search results",
  },
  {
    name: "Divider",
    poolLabel: "Divider",
    group: "layout",
    custom: false,
    purpose: "A thin separating line.",
    props: "(none)",
    predictHint: "a separator line",
  },
  {
    name: "Tabs",
    poolLabel: "Tabs",
    group: "layout",
    custom: false,
    purpose: "Switch between a few panels.",
    props: "tabs: [{title, child (id)}]",
    predictHint: "tabs that switch between a few views",
  },
  {
    name: "Button",
    poolLabel: "Button",
    group: "input",
    custom: false,
    purpose: "Sends an action to the agent.",
    props:
      'child (id of a Text), variant?: "default"|"primary"|"borderless", action: {"event":{"name","context":{...}}}, @checks?: [{condition, message}], icon?',
    predictHint: "a button to confirm, submit or continue",
  },
  {
    name: "TextField",
    poolLabel: "Text field",
    group: "input",
    custom: false,
    purpose: "Free text input. Only for text that cannot be a choice.",
    props: 'label, value (bind with @path), placeholder?, variant?: "shortText"|"longText"|"number"',
    predictHint: "a free text input box, such as a name, a city or a note",
  },
  {
    name: "ChoicePicker",
    poolLabel: "Chips",
    group: "input",
    custom: false,
    purpose: "Pick from 2 to 6 fixed options, shown as chips.",
    props:
      'label?, options: [{label, value}], value (string array, bind with @path), variant?: "mutuallyExclusive"|"multipleSelection"',
    predictHint: "a few option chips to pick from, such as times, sizes or categories",
  },
  {
    name: "Slider",
    poolLabel: "Slider",
    group: "input",
    custom: false,
    purpose: "Pick a number in a range.",
    props: "label?, min, max, steps?, value (bind with @path)",
    predictHint: "a slider for a number in a range, such as a budget or distance",
  },
  {
    name: "CheckBox",
    poolLabel: "Checkbox",
    group: "input",
    custom: false,
    purpose: "One on/off option.",
    props: "label, value (boolean, bind with @path)",
    predictHint: "a checkbox for one yes/no option or a checklist item",
  },
  {
    name: "DateTimeInput",
    poolLabel: "Date / time",
    group: "input",
    custom: false,
    purpose: 'Date and/or time. Date "YYYY-MM-DD", time "HH:mm".',
    props: "label?, value (bind with @path), enableDate?, enableTime?",
    predictHint: "a date or time picker",
  },
  {
    name: "Stepper",
    poolLabel: "Stepper",
    group: "custom",
    custom: true,
    purpose: "A small count with − and + buttons, such as guests or bags.",
    props: "label, min?, max?, value (number, bind with @path)",
    predictHint: "a small count with plus and minus buttons, such as number of guests",
  },
  {
    name: "OptionCard",
    poolLabel: "Option card",
    group: "custom",
    custom: true,
    purpose: "One selectable item (place, flight, plan). The whole card is a button.",
    props: "title, subtitle?, tags? (string array), price?, selected? (boolean), action, icon?",
    predictHint: "selectable cards for choosing between items such as restaurants, flights or plans",
  },
  {
    name: "SeatMap",
    poolLabel: "Seat map",
    group: "custom",
    custom: true,
    purpose: "Pick one seat on a plane.",
    props: 'rows (number, literal), layout (literal, e.g. "ABC DEF"), taken? (seat ids), value (seat id, bind with @path)',
    predictHint: "a seat map to choose a seat on a plane, train or venue",
  },
  {
    name: "Stat",
    poolLabel: "Stat",
    group: "custom",
    custom: true,
    purpose: "One big number with a label, such as a total or a share.",
    props: "label, value, unit?",
    predictHint: "a big highlighted number such as a total, a price or a score",
  },
  {
    name: "Icon",
    poolLabel: "Icon",
    group: "content",
    custom: false,
    purpose: "A small symbol from ICONS beside text.",
    props: 'name (one of ICONS), size?: "sm"|"md"|"lg"',
    predictHint: "a small icon or symbol next to text",
  },
  {
    name: "Image",
    poolLabel: "Image",
    group: "content",
    custom: false,
    purpose: "A photo of a place or product from live data; shows nothing when the result has none.",
    props: 'url (bind to a data field "image"), alt, aspect?: "wide"|"square"',
    predictHint: "a photo or picture of a place or product",
  },
  {
    name: "Table",
    poolLabel: "Table",
    group: "layout",
    custom: true,
    purpose: "A read-only comparison: one row per item, one column per fact.",
    props: 'columns: [{label, field}], rows: {"@path":"/pointer"} or a literal array of objects',
    predictHint: "a table comparing several items by the same facts",
  },
  {
    name: "Accordion",
    poolLabel: "Accordion",
    group: "layout",
    custom: true,
    purpose: "Sections that open and close; the first one starts open.",
    props: "items: [{title, child (id)}]",
    predictHint: "collapsible sections that expand to show details",
  },
  {
    name: "Chart",
    poolLabel: "Chart",
    group: "content",
    custom: true,
    purpose: "Horizontal bars comparing up to 12 numbers on one scale.",
    props: 'items: {"@path":"/pointer"} or literal [{label, value (number)}], unit?, type?: "bar"',
    predictHint: "a bar chart comparing numbers",
  },
  {
    name: "Timeline",
    poolLabel: "Timeline",
    group: "content",
    custom: true,
    purpose: "A schedule or itinerary: steps in time order.",
    props: 'items: {"@path":"/pointer"} or literal [{title, time?, detail?}]',
    predictHint: "a schedule or itinerary of steps with times",
  },
  {
    name: "Badge",
    poolLabel: "Badge",
    group: "content",
    custom: true,
    purpose: "A short status label.",
    props: 'text, variant?: "neutral"|"success"|"warning"|"danger"',
    predictHint: "a small status label",
  },
  {
    name: "Alert",
    poolLabel: "Alert",
    group: "content",
    custom: true,
    purpose: "A short notice: a tip, a warning or a confirmation.",
    props: 'title?, text, variant?: "info"|"warning"|"success"',
    predictHint: "a notice or warning message",
  },
  {
    name: "Progress",
    poolLabel: "Progress",
    group: "content",
    custom: true,
    purpose: "A bar showing how far along something is.",
    props: "value (number), max? (default 100), label?",
    predictHint: "a progress bar showing how far along something is",
  },
  {
    name: "Rating",
    poolLabel: "Rating",
    group: "content",
    custom: true,
    purpose: "Stars for a rating from live data; shows nothing without one.",
    props: 'value (bind to a data field "rating"), max? (default 5)',
    predictHint: "a star rating",
  },
];

export const BRICK_NAMES: readonly BrickName[] = BRICKS.map((b) => b.name);

const BRICK_SET = new Set<string>(BRICK_NAMES);
export function isBrickName(name: string): name is BrickName {
  return BRICK_SET.has(name);
}

export function brickDef(name: BrickName): BrickDef {
  const def = BRICKS.find((b) => b.name === name);
  if (!def) throw new Error(`Unknown brick ${name}`);
  return def;
}

/** Input bricks: they write back to their bound @path. */
export const INPUT_BRICKS: ReadonlySet<BrickName> = new Set<BrickName>([
  "TextField",
  "ChoicePicker",
  "Slider",
  "CheckBox",
  "DateTimeInput",
  "Stepper",
  "SeatMap",
]);

export const FUNCTION_NAMES = [
  "formatString",
  "formatCurrency",
  "formatNumber",
  "formatDate",
  "required",
  "numeric",
  "and",
  "or",
  "not",
] as const;
export type FunctionName = (typeof FUNCTION_NAMES)[number];
const FUNCTION_SET = new Set<string>(FUNCTION_NAMES);
export function isFunctionName(name: string): name is FunctionName {
  return FUNCTION_SET.has(name);
}

/** The COMPONENTS block of the composer system prompt. */
export function catalogPromptBlock(): string {
  return BRICKS.map((b) => `  ${b.name}: ${b.props}. ${b.purpose}`).join("\n");
}

/** Catalog as JSON, served publicly at CATALOG_PATH. */
export function catalogJson(catalogId: string) {
  return {
    catalogId,
    version: "1.0",
    components: BRICKS.map(({ name, custom, purpose, props }) => ({ name, custom, purpose, props })),
    functions: FUNCTION_NAMES,
  };
}
