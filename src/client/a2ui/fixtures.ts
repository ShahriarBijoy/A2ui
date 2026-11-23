/**
 * Dev fixtures: A2UI message sequences for the dev runner and the visual check (PLAN step 3).
 * Each fixture is an array of messages and the same thing as JSONL.
 */
import type { A2uiMessage } from "@shared/a2ui";
import { CATALOG_PATH } from "@shared/catalog";

export type Fixture = { id: string; label: string; messages: A2uiMessage[]; jsonl: string };

/** Any origin works: the processor only checks the catalog path suffix. */
export const FIXTURE_CATALOG_ID = "https://brick-box.local" + CATALOG_PATH;

export function toJsonl(messages: readonly A2uiMessage[]): string {
  return messages.map((m) => JSON.stringify(m)).join("\n");
}

function fixture(id: string, label: string, messages: A2uiMessage[]): Fixture {
  return { id, label, messages, jsonl: toJsonl(messages) };
}

const required = (path: string) => ({ "@call": "required", args: { value: { "@path": path } } });

export const DINNER_STEP_2 = fixture("dinner", "Dinner step 2", [
  { version: "1.0", createSurface: { surfaceId: "s2", catalogId: FIXTURE_CATALOG_ID } },
  {
    version: "1.0",
    updateDataModel: {
      surfaceId: "s2",
      path: "/",
      value: { booking: { place: "Placeholder Bistro", time: ["19:00"], guests: 4 } },
    },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s2",
      components: [
        { id: "root", component: "Card", child: "form" },
        { id: "form", component: "Column", children: ["title", "time", "guests", "confirm"] },
      ],
    },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s2",
      components: [
        {
          id: "title",
          component: "Text",
          text: { "@call": "formatString", args: { value: "## Table at ${/booking/place}" } },
        },
        {
          id: "time",
          component: "ChoicePicker",
          label: "Time",
          variant: "mutuallyExclusive",
          options: ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30"].map((t) => ({ label: t, value: t })),
          value: { "@path": "/booking/time" },
        },
        { id: "guests", component: "Stepper", label: "Guests", min: 1, max: 12, value: { "@path": "/booking/guests" } },
        {
          id: "confirm",
          component: "Button",
          variant: "primary",
          child: "confirm_label",
          action: {
            event: {
              name: "confirm_booking",
              context: {
                place: { "@path": "/booking/place" },
                time: { "@path": "/booking/time" },
                guests: { "@path": "/booking/guests" },
              },
            },
          },
          "@checks": [{ condition: required("/booking/time"), message: "Pick a time" }],
        },
        { id: "confirm_label", component: "Text", text: "Confirm" },
      ],
    },
  },
]);

export const FLIGHT_SEAT_MAP = fixture("seatmap", "Flight seat map", [
  { version: "1.0", createSurface: { surfaceId: "s5", catalogId: FIXTURE_CATALOG_ID } },
  {
    version: "1.0",
    updateDataModel: { surfaceId: "s5", path: "/", value: { flight: { id: "f2", price_eur: 312, demo: true }, seat: "" } },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s5",
      components: [
        { id: "root", component: "Column", children: ["title", "route", "seats", "price", "confirm"] },
        { id: "title", component: "Text", text: "## Pick a seat" },
        { id: "route", component: "Text", variant: "caption", text: "DA 412 · BRE → JFK" },
      ],
    },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s5",
      components: [
        {
          id: "seats",
          component: "SeatMap",
          rows: 20,
          layout: "ABC DEF",
          taken: ["1A", "1B", "3C", "4D", "7F", "10A", "12C"],
          value: { "@path": "/seat" },
        },
        {
          id: "price",
          component: "Stat",
          label: "Price",
          value: { "@call": "formatCurrency", args: { value: { "@path": "/flight/price_eur" }, currency: "EUR" } },
        },
        {
          id: "confirm",
          component: "Button",
          variant: "primary",
          child: "confirm_label",
          action: {
            event: { name: "confirm_seat", context: { flight: { "@path": "/flight/id" }, seat: { "@path": "/seat" } } },
          },
          "@checks": [{ condition: required("/seat"), message: "Pick a seat" }],
        },
        { id: "confirm_label", component: "Text", text: "Confirm seat" },
      ],
    },
  },
]);

export const REFUSED = fixture("refused", "Refused component", [
  { version: "1.0", createSurface: { surfaceId: "s9", catalogId: FIXTURE_CATALOG_ID } },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s9",
      components: [
        { id: "root", component: "Column", children: ["title", "login", "probe", "guest"] },
        { id: "title", component: "Text", text: "## Sign in" },
        { id: "login", component: "LoginForm" },
        { id: "probe", component: "Text", text: { "@call": "eval", args: { value: "document.cookie" } } },
        {
          id: "guest",
          component: "Button",
          child: "guest_label",
          action: { event: { name: "continue_as_guest" } },
        },
        { id: "guest_label", component: "Text", text: "Continue as guest" },
      ],
    },
  },
]);

/** The three fixtures PLAN step 3 asks for. */
export const FIXTURES: readonly Fixture[] = [DINNER_STEP_2, FLIGHT_SEAT_MAP, REFUSED];

/** Extra, for the visual check only: every brick the three fixtures do not use. */
export const GALLERY = fixture("gallery", "All bricks", [
  { version: "1.0", createSurface: { surfaceId: "s7", catalogId: FIXTURE_CATALOG_ID } },
  {
    version: "1.0",
    updateDataModel: {
      surfaceId: "s7",
      path: "/",
      value: {
        trip: { note: "", budget: 300, flexible: true, date: "2026-11-28", time: "19:30" },
        places: [
          { id: "p1", name: "Placeholder Bistro", kind: "Bistro", walk_min: 4, price: "€€", tags: ["cozy", "late"] },
          { id: "p2", name: "Sample Noodle Bar", kind: "Noodles", walk_min: 7, price: "€", tags: ["quick"] },
        ],
      },
    },
  },
  {
    version: "1.0",
    updateComponents: {
      surfaceId: "s7",
      components: [
        { id: "root", component: "Column", children: ["g_title", "g_tabs"] },
        { id: "g_title", component: "Text", text: "## All bricks\nA **bold** word in body text." },
        {
          id: "g_tabs",
          component: "Tabs",
          tabs: [
            { title: "Inputs", child: "g_inputs" },
            { title: "Options", child: "g_options" },
          ],
        },
        { id: "g_inputs", component: "Column", children: ["g_note", "g_budget", "g_flex", "g_when", "g_save"] },
        {
          id: "g_note",
          component: "TextField",
          label: "Note",
          placeholder: "Anything we should know?",
          value: { "@path": "/trip/note" },
        },
        { id: "g_budget", component: "Slider", label: "Budget (EUR)", min: 0, max: 1000, steps: 50, value: { "@path": "/trip/budget" } },
        { id: "g_flex", component: "CheckBox", label: "Dates are flexible", value: { "@path": "/trip/flexible" } },
        { id: "g_when", component: "Row", children: ["g_date", "g_time"], align: "end" },
        { id: "g_date", component: "DateTimeInput", label: "Date", enableDate: true, value: { "@path": "/trip/date" } },
        {
          id: "g_time",
          component: "DateTimeInput",
          label: "Time",
          enableDate: false,
          enableTime: true,
          value: { "@path": "/trip/time" },
        },
        {
          id: "g_save",
          component: "Button",
          variant: "primary",
          child: "g_save_label",
          action: { event: { name: "save_note", context: { note: { "@path": "/trip/note" } } } },
          "@checks": [{ condition: required("/trip/note"), message: "Add a note first" }],
        },
        { id: "g_save_label", component: "Text", text: "Save" },
        { id: "g_options", component: "Column", children: ["g_list", "g_divider", "g_stats"] },
        { id: "g_list", component: "List", children: { path: "/places", componentId: "g_place" } },
        {
          id: "g_place",
          component: "OptionCard",
          title: { "@path": "name" },
          subtitle: { "@call": "formatString", args: { value: "${kind} · ${walk_min} min walk" } },
          tags: { "@path": "tags" },
          price: { "@path": "price" },
          action: { event: { name: "pick_place", context: { id: { "@path": "id" }, name: { "@path": "name" } } } },
        },
        { id: "g_divider", component: "Divider" },
        { id: "g_stats", component: "Row", justify: "spaceBetween", children: ["g_stat_budget", "g_stat_walk"] },
        {
          id: "g_stat_budget",
          component: "Stat",
          label: "Budget",
          value: { "@call": "formatCurrency", args: { value: { "@path": "/trip/budget" } } },
        },
        { id: "g_stat_walk", component: "Stat", label: "Walk", value: { "@path": "/places/0/walk_min" }, unit: "min" },
      ],
    },
  },
]);
