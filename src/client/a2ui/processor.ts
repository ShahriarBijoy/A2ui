/**
 * Applies one raw A2UI message to the surfaces map. Pure: no React, no store, never throws.
 * Invalid input becomes VALIDATION_FAILED errors; refused components keep their slot
 * as a "refused" entry so the rest of the surface still renders (U10).
 */
import type { A2uiError, A2uiMessageKind, CatalogComponent, JsonValue } from "@shared/a2ui";
import { A2UI_MESSAGE_KINDS, A2UI_VERSION, isChildTemplate, isFunctionCall, isPathBinding, isPlainObject } from "@shared/a2ui";
import { CATALOG_PATH, isBrickName, isFunctionName, type BrickName } from "@shared/catalog";
import { isIconName } from "@shared/icons";
import { formatPointer, getAt, parsePointer, setAt } from "@shared/pointer";
import type { ComponentEntry, SurfaceState } from "@/state";

export type ApplyOptions = { now: number; turnId: string | null };

export type ApplyResult = {
  surfaces: Record<string, SurfaceState>;
  /** True when the message was applied exactly as sent (no errors at all). */
  ok: boolean;
  /** Set when the envelope was valid and the message was applied, possibly with refused components. */
  kind?: A2uiMessageKind;
  surfaceId: string;
  /** Types of component ids accepted for the first time by this message (re-sends don't count). */
  acceptedTypes: BrickName[];
  /** Refused components, or 1 when the whole message was rejected. */
  refused: number;
  changedPaths: string[];
  errors: A2uiError[];
  /** This message created the surface: createSurface, or the lenient auto-create on first use. */
  created: boolean;
};

type Raw = { [key: string]: unknown };

const KIND_SET = new Set<string>(A2UI_MESSAGE_KINDS);
const isKind = (key: string): key is A2uiMessageKind => KIND_SET.has(key);

function err(surfaceId: string, path: string, message: string): A2uiError {
  return { code: "VALIDATION_FAILED", surfaceId, path, message };
}

export function emptySurface(id: string, catalogId: string, turnId: string | null): SurfaceState {
  return { id, catalogId, turnId, components: {}, data: {}, changed: {}, hasDemoData: false };
}

/** Any object anywhere in the data with demo: true. */
export function containsDemoData(value: JsonValue | undefined): boolean {
  if (Array.isArray(value)) return value.some(containsDemoData);
  if (value === null || typeof value !== "object") return false;
  if (value.demo === true) return true;
  return Object.values(value).some(containsDemoData);
}

function guessSurfaceId(raw: Raw): string {
  for (const [key, body] of Object.entries(raw)) {
    if (key !== "version" && isPlainObject(body) && typeof body.surfaceId === "string") return body.surfaceId;
  }
  return "";
}

export function applyMessage(
  surfaces: Record<string, SurfaceState>,
  raw: unknown,
  opts: ApplyOptions,
): ApplyResult {
  const reject = (surfaceId: string, path: string, message: string): ApplyResult => ({
    surfaces,
    ok: false,
    surfaceId,
    acceptedTypes: [],
    refused: 1,
    changedPaths: [],
    errors: [err(surfaceId, path, message)],
    created: false,
  });

  if (!isPlainObject(raw)) return reject("", "/", "A message must be a JSON object");
  const guess = guessSurfaceId(raw);
  if (raw.version !== A2UI_VERSION) return reject(guess, "/", 'A message needs "version": "1.0"');
  const keys = Object.keys(raw).filter((k) => k !== "version");
  const unknown = keys.filter((k) => !isKind(k));
  if (unknown.length > 0) {
    return reject(guess, "/", "Unknown message key " + unknown.map((k) => JSON.stringify(k)).join(", "));
  }
  if (keys.length !== 1) {
    return reject(guess, "/", "A message needs exactly one of " + A2UI_MESSAGE_KINDS.join(", "));
  }
  const kind = keys[0] as A2uiMessageKind;
  const body = raw[kind];
  if (!isPlainObject(body)) return reject(guess, "/" + kind, kind + " must be an object");
  const surfaceId = body.surfaceId;
  if (typeof surfaceId !== "string" || surfaceId === "") {
    return reject(guess, "/" + kind + "/surfaceId", "surfaceId must be a non-empty string");
  }

  switch (kind) {
    case "createSurface":
      return createSurface(surfaces, body, surfaceId, opts, reject);
    case "updateComponents":
      return updateComponents(surfaces, body, surfaceId, opts, reject);
    case "updateDataModel":
      return updateDataModel(surfaces, body, surfaceId, opts, reject);
    case "deleteSurface": {
      const next = { ...surfaces };
      delete next[surfaceId];
      return done(next, kind, surfaceId);
    }
  }
}

type Reject = (surfaceId: string, path: string, message: string) => ApplyResult;

function done(
  surfaces: Record<string, SurfaceState>,
  kind: A2uiMessageKind,
  surfaceId: string,
  extra: Partial<ApplyResult> = {},
): ApplyResult {
  const errors = extra.errors ?? [];
  return {
    surfaces,
    ok: errors.length === 0,
    kind,
    surfaceId,
    acceptedTypes: [],
    refused: 0,
    changedPaths: [],
    created: false,
    ...extra,
    errors,
  };
}

function createSurface(
  surfaces: Record<string, SurfaceState>,
  body: Raw,
  surfaceId: string,
  opts: ApplyOptions,
  reject: Reject,
): ApplyResult {
  const catalogId = body.catalogId;
  if (typeof catalogId !== "string" || !catalogId.endsWith(CATALOG_PATH)) {
    return reject(surfaceId, "/createSurface/catalogId", "catalogId must end with " + CATALOG_PATH);
  }
  const prev = surfaces[surfaceId];
  if (prev && prev.catalogId === "" && prev.turnId === opts.turnId) {
    // The model wrote to the new id before creating it (lenient auto-create in this same turn):
    // adopt that surface instead of wiping what already arrived.
    return done({ ...surfaces, [surfaceId]: { ...prev, catalogId } }, "createSurface", surfaceId);
  }
  // Re-creating an existing id starts it over, per A2UI.
  const next = { ...surfaces, [surfaceId]: emptySurface(surfaceId, catalogId, opts.turnId) };
  return done(next, "createSurface", surfaceId, { created: true });
}

function updateComponents(
  surfaces: Record<string, SurfaceState>,
  body: Raw,
  surfaceId: string,
  opts: ApplyOptions,
  reject: Reject,
): ApplyResult {
  const list = body.components;
  if (!Array.isArray(list)) return reject(surfaceId, "/updateComponents/components", "components must be an array");

  // Lenient: the composer sometimes skips createSurface.
  const existing = surfaces[surfaceId];
  const prev = existing ?? emptySurface(surfaceId, "", opts.turnId);
  const components: Record<string, ComponentEntry> = { ...prev.components };
  const errors: A2uiError[] = [];
  const acceptedTypes: BrickName[] = [];
  const counted = new Set<string>();
  let refused = 0;

  list.forEach((c: unknown, i: number) => {
    const base = "/components/" + i;
    if (!isPlainObject(c)) {
      errors.push(err(surfaceId, base, "A component must be an object"));
      refused++;
      return;
    }
    const id = c.id;
    if (typeof id !== "string" || id === "") {
      errors.push(err(surfaceId, base + "/id", "A component needs a string id"));
      refused++;
      return;
    }
    // Keep the original firstSeen so a re-sent component does not fade in again.
    const firstSeen = components[id]?.firstSeen ?? opts.now;
    const type = c.component;
    const refuse = (path: string, reason: string, message: string) => {
      components[id] = {
        status: "refused",
        id,
        component: typeof type === "string" && type !== "" ? type : "?",
        reason,
        firstSeen,
      };
      errors.push(err(surfaceId, base + path, message));
      refused++;
    };

    if (typeof type !== "string" || type === "") {
      refuse("/component", "Missing component type", "A component needs a string component type");
      return;
    }
    if (!isBrickName(type)) {
      refuse("/component", "Not in the catalog", "Unknown component " + JSON.stringify(type));
      return;
    }
    // A bad check drops only that check (with its error); the Button is usually the screen's primary action.
    const comp = sanitizeChecks(c, surfaceId, base, errors);
    const badCall = findUnknownCall(comp);
    if (badCall) {
      refuse(badCall.path, "Unknown function", "Unknown function " + JSON.stringify(badCall.name));
      return;
    }
    const problem = validateProps(type, comp);
    if (problem) {
      refuse("/" + problem.prop, problem.message, problem.message);
      return;
    }
    const wasOk = prev.components[id]?.status === "ok";
    components[id] = { status: "ok", def: comp as unknown as CatalogComponent, firstSeen };
    if (!wasOk && !counted.has(id)) {
      counted.add(id);
      acceptedTypes.push(type);
    }
  });

  const surface: SurfaceState = { ...prev, components };
  return done({ ...surfaces, [surfaceId]: surface }, "updateComponents", surfaceId, {
    acceptedTypes,
    refused,
    errors,
    created: existing === undefined,
  });
}

function updateDataModel(
  surfaces: Record<string, SurfaceState>,
  body: Raw,
  surfaceId: string,
  opts: ApplyOptions,
  reject: Reject,
): ApplyResult {
  const rawPath = body.path;
  const path = rawPath === undefined || rawPath === "" ? "/" : rawPath;
  if (typeof path !== "string" || !path.startsWith("/")) {
    return reject(surfaceId, "/updateDataModel/path", "path must be an absolute JSON Pointer");
  }
  if (!("value" in body) || body.value === undefined) {
    return reject(surfaceId, "/updateDataModel/value", "value is required (null deletes)");
  }
  // Same leniency as updateComponents: data may arrive before the components.
  const existing = surfaces[surfaceId];
  const prev = existing ?? emptySurface(surfaceId, "", opts.turnId);
  let data: JsonValue;
  try {
    data = setAt(prev.data, path, body.value as JsonValue);
  } catch (e) {
    return reject(surfaceId, "/updateDataModel/path", e instanceof Error ? e.message : String(e));
  }
  // U5 flashes edits only. Filling a surface in the turn that created it is not an edit, and a
  // message outside any turn (applyA2ui) never is one. Only leaves whose value changed get a stamp,
  // so rewriting a parent object flashes the one control that changed, not every sibling.
  const isEdit = existing !== undefined && opts.turnId !== null && existing.turnId !== opts.turnId;
  let changed = prev.changed;
  if (isEdit) {
    changed = { ...prev.changed };
    for (const leaf of changedLeaves(getAt(prev.data, path), getAt(data, path), parsePointer(path))) {
      changed[leaf] = opts.now;
    }
  }
  const surface: SurfaceState = { ...prev, data, changed, hasDemoData: containsDemoData(data) };
  return done({ ...surfaces, [surfaceId]: surface }, "updateDataModel", surfaceId, {
    changedPaths: [path],
    created: existing === undefined,
  });
}

const MAX_STAMPS = 64;

function sameJson(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ao = a as { [key: string]: JsonValue };
  const bo = b as { [key: string]: JsonValue };
  const keys = Object.keys(ao);
  return keys.length === Object.keys(bo).length && keys.every((k) => k in bo && sameJson(ao[k], bo[k]));
}

/** Pointers of the leaves that differ between two values; a big rewrite collapses to its root. */
function changedLeaves(before: JsonValue | undefined, after: JsonValue | undefined, tokens: string[]): string[] {
  const out: string[] = [];
  const walk = (a: JsonValue | undefined, b: JsonValue | undefined, at: string[]) => {
    if (out.length > MAX_STAMPS || sameJson(a, b)) return;
    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
      a.forEach((v, i) => walk(v, b[i], [...at, String(i)]));
      return;
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const ao = a as { [key: string]: JsonValue };
      const bo = b as { [key: string]: JsonValue };
      for (const key of new Set([...Object.keys(ao), ...Object.keys(bo)])) walk(ao[key], bo[key], [...at, key]);
      return;
    }
    out.push(formatPointer(at));
  };
  walk(before, after, tokens);
  return out.length > MAX_STAMPS ? [formatPointer(tokens)] : out;
}

// ── Validation ───────────────────────────────────────────────────────────────

type UnknownCall = { name: string; path: string };

/** First "@call" under value naming a function the renderer does not have; path is relative to the walk's start. */
function walkUnknownCall(value: unknown, tokens: string[]): UnknownCall | null {
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = walkUnknownCall(value[i], [...tokens, String(i)]);
      if (hit) return hit;
    }
    return null;
  }
  if (!isPlainObject(value)) return null;
  if (isFunctionCall(value) && !isFunctionName(value["@call"])) {
    return { name: value["@call"], path: formatPointer([...tokens, "@call"]) };
  }
  for (const [key, v] of Object.entries(value)) {
    const hit = walkUnknownCall(v, [...tokens, key]);
    if (hit) return hit;
  }
  return null;
}

/** Pointer (relative to the component) of the first unknown "@call" in its props. */
function findUnknownCall(component: Raw): UnknownCall | null {
  for (const [key, v] of Object.entries(component)) {
    if (key === "id" || key === "component") continue;
    const hit = walkUnknownCall(v, [key]);
    if (hit) return hit;
  }
  return null;
}

export const DEFAULT_CHECK_MESSAGE = "Please complete this step";

/**
 * Lenient "@checks": a check without a message gets a default one; a check whose condition is
 * missing or calls an unknown function is dropped with a VALIDATION_FAILED error for that check.
 * Returns the component with the cleaned list (or without "@checks" when it was not a list).
 */
function sanitizeChecks(c: Raw, surfaceId: string, base: string, errors: A2uiError[]): Raw {
  const raw = c["@checks"];
  if (raw === undefined) return c;
  if (!Array.isArray(raw)) {
    errors.push(err(surfaceId, base + "/@checks", "@checks must be a list of {condition, message}"));
    const rest = { ...c };
    delete rest["@checks"];
    return rest;
  }
  const kept: { condition: unknown; message: string }[] = [];
  raw.forEach((check: unknown, j: number) => {
    const at = base + "/@checks/" + j;
    if (!isPlainObject(check) || check.condition === undefined || check.condition === null) {
      errors.push(err(surfaceId, at + "/condition", "A check needs a condition"));
      return;
    }
    const bad = walkUnknownCall(check.condition, []);
    if (bad) {
      errors.push(err(surfaceId, at + "/condition" + bad.path, "Unknown function " + JSON.stringify(bad.name)));
      return;
    }
    const message = typeof check.message === "string" && check.message.trim() !== "" ? check.message : DEFAULT_CHECK_MESSAGE;
    kept.push({ condition: check.condition, message });
  });
  return { ...c, "@checks": kept };
}

/** No icon (absent or null: older screens and replays) or a name from the icon set. */
function isOptionalIcon(v: unknown): boolean {
  return v === undefined || v === null || isIconName(v);
}

function isChildList(v: unknown): boolean {
  return (Array.isArray(v) && v.every((x) => typeof x === "string")) || isChildTemplate(v);
}

/** A path binding, or a literal array whose every item passes `item`. */
function isItems(v: unknown, item: (x: { [key: string]: unknown }) => boolean): boolean {
  if (isPathBinding(v)) return true;
  return Array.isArray(v) && v.every((x) => isPlainObject(x) && item(x));
}

function isNumeric(v: unknown): boolean {
  if (typeof v === "number") return Number.isFinite(v);
  return typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v));
}

/** undefined (the default) or one of the listed strings. */
function oneOf(v: unknown, allowed: readonly string[]): boolean {
  return v === undefined || (typeof v === "string" && allowed.includes(v));
}

function isAction(v: unknown): boolean {
  if (!isPlainObject(v) || !isPlainObject(v.event)) return false;
  const { name, context } = v.event;
  return typeof name === "string" && name !== "" && (context === undefined || isPlainObject(context));
}

/**
 * Minimal per-type validation: only props without which the brick cannot render.
 * Missing labels are tolerated (rendered without one): on stage a slightly bare control
 * beats a refused one.
 */
function validateProps(type: BrickName, c: Raw): { prop: string; message: string } | null {
  const missing = (prop: string) => ({ prop, message: type + " needs " + prop });
  const bad = (prop: string, message: string) => ({ prop, message });
  const has = (prop: string) => c[prop] !== undefined && c[prop] !== null;

  switch (type) {
    case "Text":
      if (!has("text")) return missing("text");
      break;
    case "Card":
      if (typeof c.child !== "string") return missing("child");
      break;
    case "Row":
    case "Column":
    case "List":
      if (!isChildList(c.children)) return missing("children");
      break;
    case "Tabs":
      if (!Array.isArray(c.tabs) || !c.tabs.every((t) => isPlainObject(t) && typeof t.child === "string")) {
        return missing("tabs");
      }
      break;
    case "Accordion":
      if (!Array.isArray(c.items) || c.items.length === 0 || !c.items.every((t) => isPlainObject(t) && typeof t.child === "string")) {
        return missing("items");
      }
      break;
    case "Icon":
      // A bound name is checked when drawn (a value outside the set draws nothing); a literal must be in the set.
      if (!isPathBinding(c.name) && !isIconName(c.name)) return bad("name", "Icon name is not in the icon set");
      if (!oneOf(c.size, ["sm", "md", "lg"])) return bad("size", "Icon size must be sm, md or lg");
      break;
    case "Table":
      if (
        !Array.isArray(c.columns) ||
        c.columns.length === 0 ||
        !c.columns.every((col) => isPlainObject(col) && typeof col.field === "string" && col.field !== "")
      ) {
        return missing("columns");
      }
      if (!isItems(c.rows, () => true)) return missing("rows");
      break;
    case "Chart":
      if (!oneOf(c.type, ["bar", "area"])) return bad("type", 'Chart type must be "bar" or "area"');
      // A numeric string counts, as it does for items bound to a path (toNumber); "€12" does not.
      if (!isItems(c.items, (x) => typeof x.label === "string" && isNumeric(x.value))) {
        return missing("items");
      }
      break;
    case "Timeline":
      if (!isItems(c.items, (x) => typeof x.title === "string")) return missing("items");
      break;
    case "Image":
      if (!has("url")) return missing("url");
      if (!has("alt")) return missing("alt");
      if (!oneOf(c.aspect, ["wide", "square"])) return bad("aspect", "Image aspect must be wide or square");
      break;
    case "Badge":
      if (!has("text")) return missing("text");
      if (!oneOf(c.variant, ["neutral", "success", "warning", "danger"])) return bad("variant", "Badge variant is not one of neutral, success, warning, danger");
      break;
    case "Alert":
      if (!has("text")) return missing("text");
      if (!oneOf(c.variant, ["info", "warning", "success"])) return bad("variant", "Alert variant is not one of info, warning, success");
      break;
    case "Progress":
      if (!has("value")) return missing("value");
      if (c.max !== undefined && (typeof c.max !== "number" || !Number.isFinite(c.max) || c.max <= 0)) return missing("max");
      break;
    case "Rating":
      if (!has("value")) return missing("value");
      if (c.max !== undefined && (typeof c.max !== "number" || !Number.isInteger(c.max) || c.max < 1 || c.max > 10)) {
        return bad("max", "Rating max must be a whole number from 1 to 10");
      }
      break;
    case "Button":
      if (typeof c.child !== "string") return missing("child");
      if (!isAction(c.action)) return missing("action");
      if (!isOptionalIcon(c.icon)) return bad("icon", "Button icon is not in the icon set");
      break;
    case "ChoicePicker":
      if (
        !Array.isArray(c.options) ||
        c.options.length === 0 ||
        !c.options.every((o) => isPlainObject(o) && typeof o.value === "string")
      ) {
        return missing("options");
      }
      if (!has("value")) return missing("value");
      break;
    case "Slider":
      if (typeof c.min !== "number") return missing("min");
      if (typeof c.max !== "number" || c.max <= c.min) return missing("max");
      if (!has("value")) return missing("value");
      break;
    case "CheckBox":
    case "DateTimeInput":
    case "Stepper":
    case "Stat":
      if (!has("value")) return missing("value");
      break;
    case "OptionCard":
      if (!has("title")) return missing("title");
      if (c.action !== undefined && !isAction(c.action)) return missing("action");
      if (!isOptionalIcon(c.icon)) return bad("icon", "OptionCard icon is not in the icon set");
      break;
    case "SeatMap":
      if (typeof c.rows !== "number" || !Number.isInteger(c.rows) || c.rows < 1 || c.rows > 99) return missing("rows");
      if (typeof c.layout !== "string" || c.layout.trim() === "") return missing("layout");
      if (!has("value")) return missing("value");
      break;
    case "TextField":
    case "Divider":
      break;
  }
  if (c.weight !== undefined && typeof c.weight !== "number") return missing("weight");
  return null;
}
