/**
 * JSON Pointer (RFC 6901) helpers with A2UI scope rules.
 * Immutable: set/remove return a new root and never mutate the input.
 */
import type { JsonValue } from "./a2ui";

export function parsePointer(pointer: string): string[] {
  if (pointer === "" || pointer === "/") return [];
  if (!pointer.startsWith("/")) throw new Error(`Not an absolute JSON Pointer: ${pointer}`);
  return pointer
    .slice(1)
    .split("/")
    .map((t) => t.replace(/~1/g, "/").replace(/~0/g, "~"));
}

export function formatPointer(tokens: readonly string[]): string {
  if (tokens.length === 0) return "/";
  return "/" + tokens.map((t) => t.replace(/~/g, "~0").replace(/\//g, "~1")).join("/");
}

/** Resolve a binding path against a scope. Absolute paths ignore the scope. "" or "." means the scope itself. */
export function resolvePath(path: string, scope: string = "/"): string {
  if (path.startsWith("/")) return path === "" ? "/" : path;
  if (path === "" || path === ".") return scope;
  const base = scope === "/" ? "" : scope.replace(/\/$/, "");
  return `${base}/${path}`;
}

export function getAt(root: JsonValue | undefined, pointer: string): JsonValue | undefined {
  let cur: JsonValue | undefined = root;
  for (const token of parsePointer(pointer)) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) {
      const i = Number(token);
      if (!Number.isInteger(i)) return undefined;
      cur = cur[i];
    } else if (typeof cur === "object") {
      cur = cur[token];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Set a value, creating objects (or arrays for numeric tokens) on the way. `null` deletes, per A2UI. */
export function setAt(root: JsonValue | undefined, pointer: string, value: JsonValue): JsonValue {
  const tokens = parsePointer(pointer);
  if (value === null) return removeAt(root, pointer);
  return setTokens(root, tokens, value);
}

function setTokens(node: JsonValue | undefined, tokens: string[], value: JsonValue): JsonValue {
  if (tokens.length === 0) return value;
  const [head, ...rest] = tokens;
  if (Array.isArray(node)) {
    const copy = node.slice();
    const i = head === "-" ? copy.length : Number(head);
    if (!Number.isInteger(i) || i < 0) throw new Error(`Bad array index "${head}"`);
    copy[i] = setTokens(copy[i], rest, value);
    return copy;
  }
  if (node !== null && node !== undefined && typeof node === "object") {
    return { ...node, [head]: setTokens(node[head], rest, value) };
  }
  // Missing or primitive: create an object container (never sparse arrays).
  return { [head]: setTokens(undefined, rest, value) };
}

export function removeAt(root: JsonValue | undefined, pointer: string): JsonValue {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) return {};
  return removeTokens(root ?? {}, tokens) ?? {};
}

function removeTokens(node: JsonValue, tokens: string[]): JsonValue {
  const [head, ...rest] = tokens;
  if (Array.isArray(node)) {
    const i = Number(head);
    if (!Number.isInteger(i) || i < 0 || i >= node.length) return node;
    const copy = node.slice();
    if (rest.length === 0) copy.splice(i, 1);
    else copy[i] = removeTokens(copy[i], rest);
    return copy;
  }
  if (node === null || typeof node !== "object" || !(head in node)) return node;
  const copy = { ...node };
  if (rest.length === 0) delete copy[head];
  else copy[head] = removeTokens(copy[head], rest);
  return copy;
}

/** True when two absolute pointers overlap (one is a prefix of the other, token-wise). */
export function pathsOverlap(a: string, b: string): boolean {
  const ta = parsePointer(a);
  const tb = parsePointer(b);
  const n = Math.min(ta.length, tb.length);
  for (let i = 0; i < n; i++) if (ta[i] !== tb[i]) return false;
  return true;
}
