/**
 * Client state contract. store.ts implements StoreApi; panels read AppState via useStore(selector).
 * State is immutable: every change produces new objects so selectors can compare by reference.
 * Contract file: change only with the controller's agreement.
 */
import type {
  A2uiAction,
  A2uiMessageKind,
  Action,
  CatalogComponent,
  JsonObject,
  JsonValue,
} from "@shared/a2ui";
import type { BrickName } from "@shared/catalog";
import type { A2uiOrigin, Mode, TurnEvent, TurnInput, TurnRequest, WidgetName } from "@shared/protocol";

export type ComponentEntry =
  | { status: "ok"; def: CatalogComponent; firstSeen: number }
  /** Not in the catalog, or failed validation: rendered as a calm "refused" placeholder (U10). */
  | { status: "refused"; id: string; component: string; reason: string; firstSeen: number };

export type SurfaceState = {
  id: string;
  catalogId: string;
  /** Turn that created the surface. */
  turnId: string | null;
  components: Record<string, ComponentEntry>;
  data: JsonValue;
  /** Absolute path → performance.now() of the last agent/knob change. Drives the 600 ms flash (U5). */
  changed: Record<string, number>;
  /** Any record in the data model has demo: true → show the "demo data" badge. */
  hasDemoData: boolean;
};

export type UsageMetrics = Omit<Extract<TurnEvent, { type: "usage" }>, "type">;
export type RouteMetrics = Omit<Extract<TurnEvent, { type: "route" }>, "type">;
export type FetchMetrics = Omit<Extract<TurnEvent, { type: "fetch" }>, "type">;

export type TurnMetrics = {
  /** performance.now() at beginTurn. */
  startedAt: number;
  route?: RouteMetrics;
  usage?: UsageMetrics;
  /** One entry per resolved data line (live web search etc.), in arrival order. */
  fetches?: FetchMetrics[];
  /** Client-measured ms from beginTurn to the first visible component, widget or html. */
  clientFirstUiMs?: number;
  /** True once any LLM output (a2ui from llm, widget, text, html, usage) arrived. */
  llmCalled: boolean;
  refused: number;
};

export type UserItem = {
  kind: "user";
  id: string;
  turnId: string;
  text: string;
  via: "voice" | "text" | "tap";
};

export type AgentItem = {
  kind: "agent";
  id: string;
  turnId: string;
  mode: Mode;
  status: "pending" | "streaming" | "done" | "error";
  /** Set when this turn created a new surface. */
  surfaceId?: string;
  /** Set when this turn changed an existing surface in place (knob patch or composer update). */
  updatedSurfaceId?: string;
  widget?: { name: WidgetName; props: JsonObject };
  /** widgets-mode fallback text. */
  text?: string;
  /** html-mode document so far. */
  html?: string;
  caption?: string;
  error?: string;
  metrics: TurnMetrics;
  replay: boolean;
  /** What to resend on "Try again" (U15). */
  retry: { input: TurnInput; display: string; via: UserItem["via"] };
};

export type ThreadItem = UserItem | AgentItem;

export type WireEntry = {
  seq: number;
  /** performance.now() */
  t: number;
  dir: "down" | "up";
  kind: A2uiMessageKind | "action" | "error";
  origin: A2uiOrigin | "renderer";
  surfaceId: string;
  turnId?: string;
  /** One line, e.g. "updateComponents s2 · 6 components". */
  summary: string;
  json: unknown;
};

export type PoolState = {
  /** Outlined while speaking (only adds within one utterance). */
  predicted: BrickName[];
  /** Filled: accepted by the processor in the current turn. */
  used: BrickName[];
  /** Session use count per brick. */
  counts: Partial<Record<BrickName, number>>;
};

export type SessionTotals = {
  turns: number;
  llmCalls: number;
  /** Turns answered by the decision model alone (route decision "patch"). */
  llmAvoided: number;
  inputTokens: number;
  outputTokens: number;
  refusals: number;
};

export type Transcript = { final: string; interim: string; listening: boolean; error?: string };

/** Recorded events of one turn, for Shift+R / replay (t = ms since turn start). */
export type TurnRecording = { display: string; via: UserItem["via"]; mode: Mode; events: { t: number; ev: TurnEvent }[] };

export type AppState = {
  mode: Mode;
  decision: boolean;
  handsFree: boolean;
  thread: ThreadItem[];
  surfaces: Record<string, SurfaceState>;
  /** The only interactive surface (U8). */
  newestSurfaceId: string | null;
  activeTurnId: string | null;
  wire: WireEntry[];
  pool: PoolState;
  totals: SessionTotals;
  transcript: Transcript;
  replaying: boolean;
  recordings: Record<string, TurnRecording>;
};

export interface StoreApi {
  getState(): AppState;
  subscribe(listener: () => void): () => void;

  setMode(mode: Mode): void;
  setDecision(on: boolean): void;
  setHandsFree(on: boolean): void;
  /** Esc: clear thread, surfaces, wire log, pool state. Keeps settings and session totals. */
  clearThread(): void;

  /** U2: synchronously adds the user line and a pending agent item (skeleton). Returns the turnId. */
  beginTurn(opts: { input: TurnInput; display: string; via: UserItem["via"]; replay?: boolean }): string;
  /** THE single ingress for server events. Records them for replay. Replay calls this too. */
  applyTurnEvent(turnId: string, ev: TurnEvent): void;
  /** Network failure or abort before "done". */
  failTurn(turnId: string, message: string): void;

  /** Fixtures / dev runner: apply a raw message outside a turn. Validates, logs, may emit errors. */
  applyA2ui(msg: unknown, origin: A2uiOrigin, turnId?: string): void;
  /** Two-way binding write from an input brick. Local only: not logged in the wire log. */
  setData(surfaceId: string, path: string, value: JsonValue): void;
  /** Button / OptionCard click: resolves context bindings in `scope`, logs "↑ action", returns it. */
  emitAction(surfaceId: string, sourceComponentId: string, action: Action, scope: string): A2uiAction;

  addPredicted(names: BrickName[]): void;
  clearPredicted(): void;

  setTranscript(t: Partial<Transcript>): void;

  /** Builds the /api/turn body from the newest surface (knobs via @shared/knobs deriveKnobs). */
  buildTurnRequest(input: TurnInput): TurnRequest;
}
