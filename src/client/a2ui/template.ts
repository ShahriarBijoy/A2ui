/**
 * List templates ({path, componentId}): what to render for the data at "path".
 * Pure, so the pending / empty / arrived states are testable without React.
 */
import type { ChildTemplate, JsonValue } from "@shared/a2ui";
import { isPlainObject } from "@shared/a2ui";
import { getAt, resolvePath } from "@shared/pointer";

export type TemplateItem = { key: string; scope: string };

export type TemplateState =
  /** Nothing at the path yet: live data arrives seconds after the UI. */
  | { kind: "pending" }
  /** An empty array (or a value that is not a list). */
  | { kind: "empty" }
  | { kind: "items"; items: TemplateItem[] };

export type TemplateView = { kind: "skeleton" } | { kind: "empty" } | { kind: "items"; items: TemplateItem[] };

/**
 * Pending data shows skeletons only while a turn is still streaming into the surface. Once it is
 * done, missing data reads as "Nothing found": a mistyped path or a search that found nothing
 * must not shimmer forever.
 */
export function templateView(template: ChildTemplate, data: JsonValue, scope: string, streaming: boolean): TemplateView {
  const state = templateState(template, data, scope);
  if (state.kind === "pending") return streaming ? { kind: "skeleton" } : { kind: "empty" };
  return state;
}

export function templateState(template: ChildTemplate, data: JsonValue, scope: string): TemplateState {
  const abs = resolvePath(template.path, scope);
  let value: JsonValue | undefined;
  try {
    value = getAt(data, abs);
  } catch {
    value = undefined;
  }
  if (value === undefined) return { kind: "pending" };
  if (!Array.isArray(value) || value.length === 0) return { kind: "empty" };
  const base = abs === "/" ? "" : abs;
  const seen = new Set<string>();
  const items = value.map((item, i) => {
    const raw = isPlainObject(item) ? item.id : undefined;
    const itemId = typeof raw === "string" || typeof raw === "number" ? String(raw) : null;
    // Stable keys keep inputs mounted when items are re-sent; duplicates fall back to the index.
    const key = itemId !== null && !seen.has(itemId) ? "id:" + itemId : "i:" + i;
    if (itemId !== null) seen.add(itemId);
    return { key, scope: base + "/" + i };
  });
  return { kind: "items", items };
}
