/**
 * A2UI v1.0 wire types (agent ⇄ renderer), as used by Brick Box.
 * Verified against github.com/google/A2UI specification/v1_0 (2026-11-23).
 * Contract file: change only with the controller's agreement.
 */
import type { IconName } from "./icons";

export const A2UI_VERSION = "1.0" as const;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

// ── Dynamic values ────────────────────────────────────────────────────────────
/** Absolute ("/trip/guests") or, inside a List template, relative ("name") JSON Pointer. */
export type PathBinding = { "@path": string };
export type FunctionCall = { "@call": string; args?: { [arg: string]: DynamicValue } };
export type DynamicValue =
  | JsonPrimitive
  | PathBinding
  | FunctionCall
  | DynamicValue[]
  | { [key: string]: DynamicValue };

export type Dynamic<T> = T | PathBinding | FunctionCall;
export type DynamicString = Dynamic<string>;
export type DynamicNumber = Dynamic<number>;
export type DynamicBoolean = Dynamic<boolean>;
export type DynamicStringList = Dynamic<string[]>;

export type CheckRule = { condition: DynamicBoolean; message: string };

export type Action = {
  event: { name: string; context?: { [key: string]: DynamicValue }; userMessage?: string };
};

/** Static ids, or a template: one child per item of the array at `path`, rendered with `componentId`. */
export type ChildTemplate = { path: string; componentId: string };
export type ChildList = string[] | ChildTemplate;

export type Justify = "start" | "center" | "end" | "spaceBetween" | "spaceAround" | "spaceEvenly" | "stretch";
export type Align = "start" | "center" | "end" | "stretch";

// ── Components (catalog: brick-box/v1) ───────────────────────────────────────
type Base<N extends string> = { id: string; component: N; "@checks"?: CheckRule[]; weight?: number };

export type TextComponent = Base<"Text"> & { text: DynamicString; variant?: "body" | "caption" | "subtitle" };
export type CardComponent = Base<"Card"> & { child: string };
export type RowComponent = Base<"Row"> & { children: ChildList; justify?: Justify; align?: Align };
export type ColumnComponent = Base<"Column"> & { children: ChildList; justify?: Justify; align?: Align };
export type ListComponent = Base<"List"> & { children: ChildList; direction?: "vertical" | "horizontal" };
export type DividerComponent = Base<"Divider"> & { axis?: "horizontal" | "vertical" };
export type TabsComponent = Base<"Tabs"> & { tabs: { title: DynamicString; child: string }[] };
export type ButtonComponent = Base<"Button"> & {
  child: string;
  variant?: "default" | "primary" | "borderless";
  action: Action;
  /** Shown before the label; a name from src/shared/icons.ts. */
  icon?: IconName;
};
export type TextFieldComponent = Base<"TextField"> & {
  label: DynamicString;
  value?: DynamicString;
  placeholder?: DynamicString;
  variant?: "shortText" | "longText" | "number";
};
export type ChoicePickerComponent = Base<"ChoicePicker"> & {
  label?: DynamicString;
  options: { label: DynamicString; value: string }[];
  value: DynamicStringList;
  variant?: "mutuallyExclusive" | "multipleSelection";
};
export type SliderComponent = Base<"Slider"> & {
  label?: DynamicString;
  min: number;
  max: number;
  steps?: number;
  value: DynamicNumber;
};
export type CheckBoxComponent = Base<"CheckBox"> & { label: DynamicString; value: DynamicBoolean };
export type DateTimeInputComponent = Base<"DateTimeInput"> & {
  label?: DynamicString;
  /** ISO date "YYYY-MM-DD", time "HH:mm", or both "YYYY-MM-DDTHH:mm". */
  value: DynamicString;
  enableDate?: boolean;
  enableTime?: boolean;
};
export type StepperComponent = Base<"Stepper"> & { label: DynamicString; min?: number; max?: number; value: DynamicNumber };
export type OptionCardComponent = Base<"OptionCard"> & {
  title: DynamicString;
  subtitle?: DynamicString;
  tags?: DynamicStringList;
  price?: DynamicString;
  selected?: DynamicBoolean;
  action?: Action;
  /** Shown before the title; a name from src/shared/icons.ts. */
  icon?: IconName;
};
export type SeatMapComponent = Base<"SeatMap"> & {
  rows: number;
  /** Literal seat letters per row; a space is the aisle, e.g. "ABC DEF". */
  layout: string;
  taken?: DynamicStringList;
  /** Seat id like "12C". */
  value: DynamicString;
};
export type StatComponent = Base<"Stat"> & { label: DynamicString; value: DynamicString | DynamicNumber; unit?: DynamicString };
export type IconComponent = Base<"Icon"> & { name: IconName; size?: "sm" | "md" | "lg" };
/** Read-only comparison. Each cell reads `field` of its row; a null or missing cell is blank. */
export type TableComponent = Base<"Table"> & {
  columns: { label: DynamicString; field: string }[];
  rows: PathBinding | JsonObject[];
};
export type ChartComponent = Base<"Chart"> & {
  type?: "bar";
  items: PathBinding | { label: string; value: number }[];
  unit?: DynamicString;
};
export type TimelineComponent = Base<"Timeline"> & {
  items: PathBinding | { title: string; time?: string; detail?: string }[];
};
/** url comes from a data line (live search), never from the composer. */
export type ImageComponent = Base<"Image"> & { url: DynamicString; alt: DynamicString; aspect?: "wide" | "square" };
export type BadgeComponent = Base<"Badge"> & { text: DynamicString; variant?: "neutral" | "success" | "warning" | "danger" };
export type AlertComponent = Base<"Alert"> & {
  title?: DynamicString;
  text: DynamicString;
  variant?: "info" | "warning" | "success";
};
export type AccordionComponent = Base<"Accordion"> & { items: { title: DynamicString; child: string }[] };
export type ProgressComponent = Base<"Progress"> & { value: DynamicNumber; max?: number; label?: DynamicString };
/** value comes from a data line ("4.5/5", 4.2); shown only when it parses. */
export type RatingComponent = Base<"Rating"> & { value: DynamicString | DynamicNumber; max?: number };

export type CatalogComponent =
  | TextComponent
  | CardComponent
  | RowComponent
  | ColumnComponent
  | ListComponent
  | DividerComponent
  | TabsComponent
  | ButtonComponent
  | TextFieldComponent
  | ChoicePickerComponent
  | SliderComponent
  | CheckBoxComponent
  | DateTimeInputComponent
  | StepperComponent
  | OptionCardComponent
  | SeatMapComponent
  | StatComponent
  | IconComponent
  | TableComponent
  | ChartComponent
  | TimelineComponent
  | ImageComponent
  | BadgeComponent
  | AlertComponent
  | AccordionComponent
  | ProgressComponent
  | RatingComponent;

export type ComponentType = CatalogComponent["component"];

/** What arrives on the wire before validation. */
export type WireComponent = { id: string; component: string; [prop: string]: unknown };

// ── Agent → renderer messages ────────────────────────────────────────────────
export type CreateSurface = { surfaceId: string; catalogId: string };
export type UpdateComponents = { surfaceId: string; components: WireComponent[] };
export type UpdateDataModel = { surfaceId: string; path?: string; value: JsonValue };
export type DeleteSurface = { surfaceId: string };

export type A2uiMessage =
  | { version: typeof A2UI_VERSION; createSurface: CreateSurface }
  | { version: typeof A2UI_VERSION; updateComponents: UpdateComponents }
  | { version: typeof A2UI_VERSION; updateDataModel: UpdateDataModel }
  | { version: typeof A2UI_VERSION; deleteSurface: DeleteSurface };

export type A2uiMessageKind = "createSurface" | "updateComponents" | "updateDataModel" | "deleteSurface";
export const A2UI_MESSAGE_KINDS: readonly A2uiMessageKind[] = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
];

// ── Renderer → agent messages ────────────────────────────────────────────────
export type A2uiAction = {
  name: string;
  surfaceId: string;
  sourceComponentId: string;
  /** ISO 8601 */
  timestamp: string;
  context: JsonObject;
};
export type A2uiError = {
  code: "VALIDATION_FAILED";
  surfaceId: string;
  /** JSON Pointer to the failing field, e.g. "/components/3/component". */
  path: string;
  message: string;
};
export type A2uiActionMessage = { version: typeof A2UI_VERSION; action: A2uiAction };
export type A2uiErrorMessage = { version: typeof A2UI_VERSION; error: A2uiError };
export type RendererMessage = A2uiActionMessage | A2uiErrorMessage;

// ── Guards ───────────────────────────────────────────────────────────────────
export function isPlainObject(v: unknown): v is { [key: string]: unknown } {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
export function isPathBinding(v: unknown): v is PathBinding {
  return isPlainObject(v) && typeof v["@path"] === "string";
}
export function isFunctionCall(v: unknown): v is FunctionCall {
  return isPlainObject(v) && typeof v["@call"] === "string";
}
export function isChildTemplate(v: unknown): v is ChildTemplate {
  return isPlainObject(v) && typeof v.path === "string" && typeof v.componentId === "string";
}
export function messageKind(msg: A2uiMessage): A2uiMessageKind {
  if ("createSurface" in msg) return "createSurface";
  if ("updateComponents" in msg) return "updateComponents";
  if ("updateDataModel" in msg) return "updateDataModel";
  return "deleteSurface";
}
export function messageSurfaceId(msg: A2uiMessage): string {
  if ("createSurface" in msg) return msg.createSurface.surfaceId;
  if ("updateComponents" in msg) return msg.updateComponents.surfaceId;
  if ("updateDataModel" in msg) return msg.updateDataModel.surfaceId;
  return msg.deleteSurface.surfaceId;
}
