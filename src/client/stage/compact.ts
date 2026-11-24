/**
 * The hood's "JSON stream": the same A2UI messages, one short line per component or data write, in a call syntax
 * (`list = List(path="/flights", item=flight)`). A compact view of the JSON the renderer received, not another format.
 * Pure, so it is unit tested and cheap to rebuild on every streamed message.
 */
import { isFunctionCall, isPathBinding, isPlainObject } from "@shared/a2ui";
import type { A2uiOrigin } from "@shared/protocol";
import type { FetchMetrics } from "@/state";

export type TokenKind =
  | "id"
  | "op"
  | "type"
  | "key"
  | "str"
  | "num"
  | "lit"
  | "bind"
  | "call"
  | "action"
  | "path"
  | "punct"
  | "note"
  | "error";
export type Token = { k: TokenKind; v: string };

export type LineKind = "surface" | "component" | "data" | "delete" | "fetch" | "action" | "error" | "invalid";

export type Line = {
  /** 1-based, continuous over the turn. */
  n: number;
  kind: LineKind;
  /** Who wrote it: the composer (llm), live data (data), the decision model (knob), or the renderer. */
  origin: A2uiOrigin | "renderer";
  /** Index of the message the line came from; -1 for a fetch that wrote nothing. */
  msg: number;
  /** Component lines: the id, to outline that component on the surface. */
  id?: string;
  /** Data lines: the absolute path written. */
  path?: string;
  tokens: Token[];
  /** The tokens joined: what the payload comparison counts. */
  text: string;
};

/** One message of the turn as the wire log has it. Renderer messages (action, error) go up, the rest come down. */
export type TurnMessage = { msg: unknown; origin: A2uiOrigin | "renderer" };

/** Longest string literal before "…". */
export const MAX_STRING = 28;
/** A search query gets a little more room: it is what the audience reads. */
export const MAX_QUERY = 44;
/** Array items and object keys shown before "…". */
const MAX_ITEMS = 4;

/** Props whose string value is a keyword, printed bare: variant=caption, not variant="caption". */
const KEYWORD_PROPS: ReadonlySet<string> = new Set([
  "variant",
  "direction",
  "axis",
  "justify",
  "align",
  "size",
  "type",
  "aspect",
  "icon",
]);

/** The first prop of these bricks prints without its name: Text("…"), Card(main), Column([a, b]). */
const POSITIONAL: Readonly<Record<string, string>> = {
  Text: "text",
  Card: "child",
  Button: "child",
  Row: "children",
  Column: "children",
  List: "children",
};

export function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ");
  return one.length > max ? one.slice(0, max - 1).trimEnd() + "…" : one;
}

const t = (k: TokenKind, v: string): Token => ({ k, v });
const sep = (): Token => t("punct", ", ");

function joinWith(parts: Token[][], separator: () => Token = sep): Token[] {
  const out: Token[] = [];
  parts.forEach((p, i) => {
    if (i > 0) out.push(separator());
    out.push(...p);
  });
  return out;
}

function str(s: string, max = MAX_STRING): Token[] {
  return [t("str", JSON.stringify(truncate(s, max)))];
}

/** "@name" for a template field, "@/abs/path" for the data model. */
function binding(path: string): Token[] {
  return [t("bind", "@" + path)];
}

function isAction(v: unknown): v is { event: { name: string } } {
  return isPlainObject(v) && isPlainObject(v.event) && typeof v.event.name === "string";
}

/** A value inside a component or a data write, compact: literals cut, bindings as @path, calls as name(args). */
export function valueTokens(v: unknown, depth = 0, key?: string): Token[] {
  if (v === null) return [t("lit", "null")];
  if (typeof v === "string") return key && KEYWORD_PROPS.has(key) ? [t("lit", truncate(v, MAX_STRING))] : str(v);
  if (typeof v === "number") return [t("num", Number.isFinite(v) ? String(v) : "NaN")];
  if (typeof v === "boolean") return [t("lit", String(v))];
  if (isPathBinding(v)) return binding(v["@path"]);
  if (isFunctionCall(v)) {
    const args = isPlainObject(v.args) ? v.args : {};
    const entries = Object.entries(args);
    // formatString and other one-argument calls read best positionally: formatString("${/a} guests").
    const parts =
      entries.length === 1 ? [valueTokens(entries[0][1], depth + 1)] : entries.map(([k, a]) => [t("key", k), t("op", "="), ...valueTokens(a, depth + 1, k)]);
    return [t("call", v["@call"]), t("punct", "("), ...joinWith(parts), t("punct", ")")];
  }
  if (isAction(v)) return [t("action", v.event.name)];
  if (Array.isArray(v)) {
    if (v.length === 0) return [t("punct", "[]")];
    // A list of objects (options, columns, chart items) reads as its size and shape: [4 × {label, value}].
    if (v.every((x) => isPlainObject(x))) {
      const keys = Object.keys(v[0] as object).slice(0, 3);
      const more = Object.keys(v[0] as object).length > keys.length ? ", …" : "";
      return [t("punct", "["), t("num", String(v.length)), t("op", " × "), t("punct", "{" + keys.join(", ") + more + "}"), t("punct", "]")];
    }
    if (depth > 1) return [t("punct", "["), t("num", String(v.length)), t("punct", "]")];
    const shown = v.slice(0, MAX_ITEMS).map((x) => valueTokens(x, depth + 1));
    const tail: Token[] = v.length > MAX_ITEMS ? [sep(), t("note", "…+" + (v.length - MAX_ITEMS))] : [];
    return [t("punct", "["), ...joinWith(shown), ...tail, t("punct", "]")];
  }
  if (isPlainObject(v)) {
    const entries = Object.entries(v);
    if (entries.length === 0) return [t("punct", "{}")];
    if (depth > 1) return [t("punct", "{…}")];
    const shown = entries.slice(0, MAX_ITEMS).map(([k, x]) => [t("key", k), t("op", ": "), ...valueTokens(x, depth + 1)]);
    const tail: Token[] = entries.length > MAX_ITEMS ? [sep(), t("note", "…")] : [];
    return [t("punct", "{"), ...joinWith(shown), ...tail, t("punct", "}")];
  }
  return [t("note", "?")];
}

/** Child ids as a bracketed list of id tokens: [title, when, list]. */
function idList(ids: unknown[]): Token[] {
  const parts = ids.map((id) => [t("id", String(id))]);
  return [t("punct", "["), ...joinWith(parts), t("punct", "]")];
}

/** The arguments of one component: positional first prop, then named props in the order they were written. */
function componentArgs(c: { [key: string]: unknown }, type: string): Token[] {
  const parts: Token[][] = [];
  const first = POSITIONAL[type];
  for (const [key, value] of Object.entries(c)) {
    if (key === "id" || key === "component" || value === undefined) continue;
    const name = key.startsWith("@") ? key.slice(1) : key;
    if (key === first) {
      if (key === "children" && isPlainObject(value) && typeof value.path === "string" && typeof value.componentId === "string") {
        // A List template: one child per item of the array at path.
        parts.unshift(
          [t("key", "path"), t("op", "="), ...str(value.path, MAX_QUERY)],
          [t("key", "item"), t("op", "="), t("id", value.componentId)],
        );
        continue;
      }
      if (key === "children" && Array.isArray(value)) {
        parts.unshift(idList(value));
        continue;
      }
      if (key === "child" && typeof value === "string") {
        parts.unshift([t("id", value)]);
        continue;
      }
      parts.unshift(valueTokens(value, 0, key));
      continue;
    }
    if (type === "Icon" && key === "name" && typeof value === "string") {
      parts.push([t("key", name), t("op", "="), t("lit", value)]);
      continue;
    }
    parts.push([t("key", name), t("op", "="), ...valueTokens(value, 0, key)]);
  }
  return joinWith(parts);
}

/** "http://localhost:5191/catalog/brick-box/v1" → "brick-box/v1". */
function shortCatalog(id: string): string {
  const at = id.indexOf("/catalog/");
  return at >= 0 ? id.slice(at + "/catalog/".length) : id;
}

function recordsNote(n: number): string {
  return n + (n === 1 ? " record" : " records");
}

type Draft = Omit<Line, "n" | "text">;

function finish(drafts: Draft[]): Line[] {
  return drafts.map((d, i) => ({ ...d, n: i + 1, text: d.tokens.map((x) => x.v).join("") }));
}

/**
 * Data lines and the fetch events that delivered them. The Worker sends a fetch right after its data write, but
 * not one for one: a picture lookup writes the same path again without one, and an empty answer for a path that
 * already has records sends only the fetch. So a fetch pairs, in order, with the next unpaired data write whose
 * record count matches it; anything left unpaired is shown on its own.
 */
export function pairFetches(messages: readonly TurnMessage[], fetches: readonly FetchMetrics[]): { paired: Map<number, FetchMetrics>; unpaired: FetchMetrics[] } {
  const paired = new Map<number, FetchMetrics>();
  const unpaired: FetchMetrics[] = [];
  let from = 0;
  for (const f of fetches) {
    let hit = -1;
    for (let i = from; i < messages.length; i++) {
      const m = messages[i];
      if (m.origin !== "data" || !isPlainObject(m.msg) || !isPlainObject(m.msg.updateDataModel)) continue;
      const n = recordCount(m.msg.updateDataModel.value);
      const want = f.ok ? f.records : 0;
      if (n === want && !paired.has(i)) {
        hit = i;
        break;
      }
    }
    if (hit < 0) {
      unpaired.push(f);
      continue;
    }
    paired.set(hit, f);
    from = hit + 1;
  }
  return { paired, unpaired };
}

/** Records in a data write: an array's items, one object (a weather report), none for null. */
function recordCount(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (value === null || value === undefined) return 0;
  return isPlainObject(value) ? 1 : -1;
}

function fetchCall(f: FetchMetrics, records: number | null): Token[] {
  const inner: Token[][] = [str(f.query, MAX_QUERY)];
  if (!f.ok) inner.push([t("error", "failed" + (f.error ? ": " + truncate(f.error, 32) : ""))]);
  else if (records !== null) inner.push([t("note", recordsNote(records))]);
  return [t("call", f.source), t("punct", "("), ...joinWith(inner), t("punct", ")")];
}

/** One line per component, data write, surface change or renderer message, in arrival order. */
export function compactLines(messages: readonly TurnMessage[], fetches: readonly FetchMetrics[] = []): Line[] {
  const { paired, unpaired } = pairFetches(messages, fetches);
  const written = new Set<string>();
  const drafts: Draft[] = [];
  messages.forEach((m, index) => {
    const raw = m.msg;
    const base = { origin: m.origin, msg: index };
    if (!isPlainObject(raw)) {
      drafts.push({ ...base, kind: "invalid", tokens: [t("error", "invalid message")] });
      return;
    }
    if (isPlainObject(raw.createSurface)) {
      const { surfaceId, catalogId } = raw.createSurface;
      drafts.push({
        ...base,
        kind: "surface",
        tokens: [
          t("id", String(surfaceId)),
          t("op", " = "),
          t("type", "Surface"),
          t("punct", "("),
          t("key", "catalog"),
          t("op", "="),
          ...str(shortCatalog(String(catalogId ?? ""))),
          t("punct", ")"),
        ],
      });
      return;
    }
    if (isPlainObject(raw.updateComponents)) {
      const list = raw.updateComponents.components;
      if (!Array.isArray(list) || list.length === 0) {
        drafts.push({ ...base, kind: "invalid", tokens: [t("note", "updateComponents with no components")] });
        return;
      }
      for (const c of list) {
        if (!isPlainObject(c) || typeof c.id !== "string") {
          drafts.push({ ...base, kind: "invalid", tokens: [t("error", "component without an id")] });
          continue;
        }
        const type = typeof c.component === "string" ? c.component : "?";
        drafts.push({
          ...base,
          kind: "component",
          id: c.id,
          tokens: [t("id", c.id), t("op", " = "), t("type", type), t("punct", "("), ...componentArgs(c, type), t("punct", ")")],
        });
      }
      return;
    }
    if (isPlainObject(raw.updateDataModel)) {
      const path = typeof raw.updateDataModel.path === "string" ? raw.updateDataModel.path : "/";
      const value = raw.updateDataModel.value;
      const head: Token[] = [t("path", path), t("op", " ← ")];
      let body: Token[];
      const fetch = paired.get(index);
      if (m.origin === "data") {
        const n = Array.isArray(value) ? value.length : null;
        if (fetch) body = fetchCall(fetch, recordCount(value));
        else if (n !== null) body = [t("note", recordsNote(n) + (written.has(path) ? " · again" : ""))];
        else body = valueTokens(value);
      } else {
        body = valueTokens(value);
      }
      written.add(path);
      drafts.push({ ...base, kind: "data", path, tokens: [...head, ...body] });
      return;
    }
    if (isPlainObject(raw.deleteSurface)) {
      drafts.push({ ...base, kind: "delete", tokens: [t("call", "deleteSurface"), t("punct", "("), t("id", String(raw.deleteSurface.surfaceId)), t("punct", ")")] });
      return;
    }
    if (isPlainObject(raw.action)) {
      const a = raw.action;
      const context = isPlainObject(a.context) ? Object.entries(a.context) : [];
      const args = context.slice(0, 3).map(([k, v]) => [t("key", k), t("op", "="), ...valueTokens(v, 1)]);
      const tail: Token[] = context.length > 3 ? [sep(), t("note", "…")] : [];
      drafts.push({
        ...base,
        kind: "action",
        tokens: [t("op", "↑ "), t("action", String(a.name)), t("punct", "("), ...joinWith(args), ...tail, t("punct", ")")],
      });
      return;
    }
    if (isPlainObject(raw.error)) {
      const e = raw.error;
      drafts.push({
        ...base,
        kind: "error",
        tokens: [t("error", "✕ refused "), t("path", String(e.path ?? "")), t("punct", " · "), t("error", truncate(String(e.message ?? ""), 48))],
      });
      return;
    }
    drafts.push({ ...base, kind: "invalid", tokens: [t("error", "unknown message")] });
  });
  for (const f of unpaired) {
    drafts.push({ origin: "data", msg: -1, kind: "fetch", tokens: [t("note", "∅ ← "), ...fetchCall(f, f.ok ? f.records : null)] });
  }
  return finish(drafts);
}

export type Payload = {
  /** Characters of the turn's A2UI JSON as sent (compact JSON, one message per line). */
  json: number;
  /** Characters of the same messages as compact lines. */
  compact: number;
  /** json / compact, or null when there is nothing to compare. */
  ratio: number | null;
  messages: number;
};

/** Characters of the agent-to-renderer messages as compact JSON, one message per line. */
export function jsonChars(messages: readonly TurnMessage[]): number {
  let n = 0;
  for (const m of messages) {
    if (m.origin === "renderer") continue;
    let s: string;
    try {
      s = JSON.stringify(m.msg) ?? "";
    } catch {
      s = String(m.msg);
    }
    n += s.length + 1;
  }
  return n;
}

/** Agent-to-renderer messages only: renderer lines (actions, refusals) and fetch notes were never in the stream. */
export function payloadSizes(messages: readonly TurnMessage[], lines: readonly Line[]): Payload {
  const json = jsonChars(messages);
  const count = messages.filter((m) => m.origin !== "renderer").length;
  let compact = 0;
  for (const l of lines) {
    if (l.origin === "renderer" || l.kind === "fetch") continue;
    compact += l.text.length + 1;
  }
  return { json, compact, ratio: compact > 0 && json > 0 ? json / compact : null, messages: count };
}
