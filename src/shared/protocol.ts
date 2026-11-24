/**
 * Client ⇄ Worker contract: /api/turn request, SSE events, /api/predict, /api/soniox-key.
 * Contract file: change only with the controller's agreement.
 */
import type { A2uiAction, A2uiMessage, JsonObject, JsonValue } from "./a2ui";
import type { BrickName } from "./catalog";

export type Mode = "a2ui" | "widgets" | "html";
export const MODES: readonly Mode[] = ["a2ui", "widgets", "html"];

export type ThreadEntry = { role: "user" | "agent" | "tap"; text: string };

export type TurnInput = { type: "utterance"; text: string } | { type: "action"; action: A2uiAction };

// ── Knobs: input values on the newest surface that the decision model may turn ──
export type KnobOption = {
  /** Jev criteria key: unique, short, human readable (e.g. "6", "20:00", "12C", "Fri 28 Nov"). */
  key: string;
  /** Longer description for the criteria text (e.g. "20:00 (1 h later)"). */
  label: string;
  /** Exact JSON to write at `path` when chosen (e.g. 6, "20:00", ["19:00"]). */
  value: JsonValue;
};

type KnobBase = {
  /** Stable id: the bound path. */
  id: string;
  componentId: string;
  component: BrickName;
  /** Absolute JSON Pointer the input is bound to. */
  path: string;
  /** Human label, e.g. "Guests". */
  label: string;
};

export type Knob =
  /** Single value: Stepper, Slider, ChoicePicker (mutuallyExclusive), DateTimeInput, SeatMap. */
  | (KnobBase & { type: "choice"; current: JsonValue; currentLabel: string; options: KnobOption[] })
  /** ChoicePicker multipleSelection: one Noul per option. */
  | (KnobBase & { type: "multi"; current: string[]; options: KnobOption[] })
  /** CheckBox: one Noul. */
  | (KnobBase & { type: "bool"; current: boolean });

export type SurfaceSnapshot = {
  id: string;
  components: { id: string; component: string }[];
  data: JsonValue;
  knobs: Knob[];
};

export type TurnRequest = {
  mode: Mode;
  /** Decision model on/off. */
  decision: boolean;
  input: TurnInput;
  /** Last 6 entries, oldest first. */
  thread: ThreadEntry[];
  surface: SurfaceSnapshot | null;
  nextSurfaceId: string;
};

export type RouteKind = "edit" | "new" | "other";

export type RoutePatch = { knobId: string; path: string; value: JsonValue; confidence: number };

/** Server-side router result (worker/router.ts). */
export type RouteResult = {
  kind: RouteKind;
  kindConfidence: number;
  /** "patch" = apply patches, skip the LLM. "compose" = call the LLM. */
  decision: "patch" | "compose";
  patches: RoutePatch[];
  ms: number;
  engine: string;
  /** Why compose was chosen (timeout, error, low confidence, partial edit, ...). */
  reason: string;
  inputTokens?: number;
};

export type A2uiOrigin = "llm" | "data" | "knob";

// ── Live data records (resolved server-side from live web search; the model never invents them) ──
export type Place = {
  id: string;
  name: string;
  kind: string;
  /** Walking minutes; null when no source states it (live search never estimates). */
  walk_min: number | null;
  /** 1..4; null when no source states it. */
  price_level: number | null;
  tags: string[];
  /** "HH:mm" or null when no source states it. */
  opens_until: string | null;
  /** Source URL (live search records). */
  source?: string;
};
/**
 * One carrier or route a live web search found for a trip. Results list route-level fares, not departures,
 * so there are no times and no computed price: the fare is shown as a result lists it.
 */
export type Flight = {
  id: string;
  /** Airline, rail or bus company, as a result names it. */
  carrier: string;
  /** Airports or cities and stops as a result states them (e.g. "BRE → JFK · 1 stop via FRA"); null when none does. */
  route: string | null;
  /** The fare as written in the result (e.g. "from €476"); null when none is stated. */
  price: string | null;
  /** Short labels, including what a listed fare is ("round trip", "Nov fares"). */
  tags: string[];
  /** Source URL. */
  source?: string;
};
/**
 * Live data sources only (owner direction: no fixed data, no demo generator): "search" = live web search,
 * "weather" = Open-Meteo forecast (one object per line, no LLM call).
 */
export type DataSource = "search" | "weather";

/** Props of the two hand-built widgets in "widgets" mode. */
export type RestaurantWidgetProps = { places: Place[]; kind?: string; max_walk_min?: number };
export type FlightSearchWidgetProps = { from?: string; to?: string; date?: string; flights: Flight[] };
export type WidgetName = "RestaurantWidget" | "FlightSearchWidget";

/** One JSON object per SSE `data:` line. */
export type TurnEvent =
  | { type: "route"; kind: RouteKind; decision: "patch" | "compose"; ms: number; engine: string; reason: string; patches: number }
  | { type: "a2ui"; msg: A2uiMessage; origin: A2uiOrigin }
  | { type: "caption"; text: string }
  | { type: "widget"; name: WidgetName; props: JsonObject }
  | { type: "text"; delta: string }
  | { type: "html"; delta: string }
  | {
      type: "usage";
      model: string;
      input_tokens: number;
      output_tokens: number;
      cache_read_tokens?: number;
      cache_write_tokens?: number;
      /** ms from LLM request start to the first rendered UI (first a2ui line / widget / html byte); null if none. */
      first_ui_ms: number | null;
      compose_ms: number;
      /** Lines that failed to parse and were skipped. */
      skipped_lines: number;
      /** Lines whose closing brackets were repaired before parsing. */
      repaired_lines?: number;
    }
  | {
      /** One resolved data line (live search), emitted after its updateDataModel. Measured values only. */
      type: "fetch";
      source: DataSource;
      query: string;
      ok: boolean;
      records: number;
      ms: number;
      searches?: number;
      input_tokens?: number;
      output_tokens?: number;
      error?: string;
    }
  | { type: "error"; message: string }
  | { type: "done" };

export type TurnEventType = TurnEvent["type"];

export type PredictRequest = { text: string };
export type PredictResponse = { bricks: Partial<Record<BrickName, number>>; ms: number; engine: string };

export type SonioxKeyResponse = { api_key: string; expires_at: string };

export const LIMITS = {
  maxBodyBytes: 64 * 1024,
  maxUtteranceChars: 400,
  threadTurns: 6,
  routerTimeoutMs: 800,
  composeTimeoutMs: 20_000,
  predictMinWords: 3,
  predictDebounceMs: 350,
  predictThreshold: 0.6,
  routeKindThreshold: 0.6,
  routeKnobThreshold: 0.6,
} as const;
