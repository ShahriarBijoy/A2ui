/**
 * Claude side of a turn: the Anthropic client, the composer/html text stream, the widgets tool call,
 * the web search call for live data lines, and the pure helpers that turn a token stream into composer lines.
 * SDK: @anthropic-ai/sdk 1.12.0 (messages.stream / messages.create). Settings follow NOTES.md "Claude API":
 * no temperature/top_p/top_k, no assistant prefill, tool_choice auto.
 */
import Anthropic from "@anthropic-ai/sdk";
import {
  A2UI_MESSAGE_KINDS,
  A2UI_VERSION,
  isPlainObject,
  type A2uiMessage,
  type JsonObject,
} from "@shared/a2ui";

export const DEFAULT_MODEL = "claude-haiku-5-5";
export const MAX_TOKENS = 3000;

/** Structural subset of the Worker Env, so tests and scripts need no wrangler types. */
export type ClaudeEnv = { ANTHROPIC_API_KEY?: string; LLM_MODEL?: string };

/**
 * Haiku 5.5 thinks by default (adaptive). Thinking delays the first line, so the composer runs without it.
 * See the lane W report for the measured comparison.
 */
export type ThinkingSetting = "disabled" | "adaptive-low" | "default";
export const COMPOSER_THINKING: ThinkingSetting = "disabled";

export type Prompt = { system?: string; cacheSystem?: boolean; user: string };

export type LlmUsage = {
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

/** Usage plus why the model stopped ("end_turn", "max_tokens", "refusal", ...; null if not reported). */
export type LlmResult = { usage: LlmUsage; stopReason: string | null };

/** Text deltas of one streamed answer; result() resolves after the stream ended. */
export interface TextStream extends AsyncIterable<string> {
  result(): Promise<LlmResult>;
  abort(): void;
}

export type ToolCall = { name: string; input: JsonObject };
export type WidgetsReply = { tool: ToolCall | null; text: string; usage: LlmUsage; stopReason: string | null };

export interface Llm {
  streamText(prompt: Prompt, signal: AbortSignal): TextStream;
  callTools(prompt: Prompt, tools: Anthropic.Tool[], signal: AbortSignal): Promise<WidgetsReply>;
}

/** The parts of a web search reply that search.ts needs, in content order. */
export type SearchBlock =
  | { type: "text"; text: string }
  /** One successful web_search_tool_result: the result URLs. */
  | { type: "results"; urls: string[] }
  /** A web_search_tool_result error (e.g. max_uses_exceeded on a second parallel query). */
  | { type: "search_error"; code: string };

export type SearchReply = {
  blocks: SearchBlock[];
  stopReason: string | null;
  /** usage.server_tool_use.web_search_requests: searches actually run (and billed). */
  searches: number;
  inputTokens: number;
  outputTokens: number;
};

export type WebSearch = (prompt: Prompt, signal: AbortSignal) => Promise<SearchReply>;

export class MissingKeyError extends Error {}

// ── Anthropic implementation ──────────────────────────────────────────────────

let cached: { key: string; client: Anthropic } | null = null;
function clientFor(env: ClaudeEnv): Anthropic {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw new MissingKeyError("ANTHROPIC_API_KEY is not set");
  // One client per key keeps the HTTP connection warm across turns in the same isolate.
  if (cached?.key !== key) cached = { key, client: new Anthropic({ apiKey: key, maxRetries: 1 }) };
  return cached.client;
}

function thinkingParams(setting: ThinkingSetting): { thinking?: Anthropic.ThinkingConfigParam; output_config?: Anthropic.OutputConfig } {
  if (setting === "disabled") return { thinking: { type: "disabled" } };
  if (setting === "adaptive-low") return { thinking: { type: "adaptive" }, output_config: { effort: "low" } };
  return {};
}

function systemParam(prompt: Prompt): Anthropic.TextBlockParam[] | undefined {
  if (!prompt.system) return undefined;
  return [
    prompt.cacheSystem
      ? { type: "text", text: prompt.system, cache_control: { type: "ephemeral" } }
      : { type: "text", text: prompt.system },
  ];
}

function toUsage(msg: Anthropic.Message): LlmUsage {
  return {
    model: msg.model,
    input_tokens: msg.usage.input_tokens,
    output_tokens: msg.usage.output_tokens,
    cache_read_tokens: msg.usage.cache_read_input_tokens ?? 0,
    cache_write_tokens: msg.usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * One search per data line: measured median ~4.5 s for one search, two searches roughly double it.
 * web_search_20260209 is not used: with Haiku 5.5 it answered invalid_tool_input on 5 of 6 probes
 * and one probe took 99 s (code execution).
 */
export const SEARCH_TOOL = { type: "web_search_20250305", name: "web_search", max_uses: 1 } as const;
export const SEARCH_MAX_TOKENS = 3000;

export function anthropicWebSearch(env: ClaudeEnv): WebSearch {
  const model = env.LLM_MODEL || DEFAULT_MODEL;
  return async (prompt, signal) => {
    const msg = await clientFor(env).messages.create(
      {
        model,
        max_tokens: SEARCH_MAX_TOKENS,
        system: systemParam(prompt),
        messages: [{ role: "user", content: prompt.user }],
        tools: [{ ...SEARCH_TOOL }],
        thinking: { type: "disabled" },
      },
      // A retry would not fit in the 12 s search budget.
      { signal, maxRetries: 0 },
    );
    return toSearchReply(msg);
  };
}

export function toSearchReply(msg: Anthropic.Message): SearchReply {
  const blocks: SearchBlock[] = [];
  for (const b of msg.content) {
    if (b.type === "text") blocks.push({ type: "text", text: b.text });
    else if (b.type === "web_search_tool_result") {
      blocks.push(Array.isArray(b.content) ? { type: "results", urls: b.content.map((r) => r.url) } : { type: "search_error", code: b.content.error_code });
    }
  }
  return {
    blocks,
    stopReason: msg.stop_reason ?? null,
    searches: msg.usage.server_tool_use?.web_search_requests ?? 0,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  };
}

export function anthropicLlm(env: ClaudeEnv, thinking: ThinkingSetting = COMPOSER_THINKING): Llm {
  const model = env.LLM_MODEL || DEFAULT_MODEL;
  return {
    streamText(prompt, signal) {
      const client = clientFor(env);
      const start = (setting: ThinkingSetting) =>
        client.messages.stream(
          {
            model,
            max_tokens: MAX_TOKENS,
            system: systemParam(prompt),
            messages: [{ role: "user", content: prompt.user }],
            ...thinkingParams(setting),
          },
          { signal },
        );
      let stream = start(thinking);
      return {
        async *[Symbol.asyncIterator]() {
          let yielded = false;
          try {
            for await (const ev of stream) {
              if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
                yielded = true;
                yield ev.delta.text;
              }
            }
          } catch (err) {
            // Insurance: if the API ever rejects thinking:disabled, rerun once with adaptive/low.
            if (yielded || thinking !== "disabled" || !(err instanceof Anthropic.BadRequestError)) throw err;
            stream = start("adaptive-low");
            for await (const ev of stream) {
              if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
            }
          }
        },
        async result() {
          const msg = await stream.finalMessage();
          return { usage: toUsage(msg), stopReason: msg.stop_reason ?? null };
        },
        abort() {
          stream.abort();
        },
      };
    },

    async callTools(prompt, tools, signal) {
      const client = clientFor(env);
      const msg = await client.messages.create(
        {
          model,
          max_tokens: MAX_TOKENS,
          system: systemParam(prompt),
          messages: [{ role: "user", content: prompt.user }],
          tools,
          tool_choice: { type: "auto" },
          ...thinkingParams(thinking),
        },
        { signal },
      );
      let tool: ToolCall | null = null;
      let text = "";
      for (const block of msg.content) {
        if (block.type === "tool_use" && !tool) {
          tool = { name: block.name, input: isPlainObject(block.input) ? (block.input as JsonObject) : {} };
        } else if (block.type === "text") {
          text += block.text;
        }
      }
      return { tool, text: text.trim(), usage: toUsage(msg), stopReason: msg.stop_reason ?? null };
    },
  };
}

/** A short line for the error event: what failed and what to check, never the raw payload. */
export function describeLlmError(err: unknown, fallbackPrefix = "Composer failed"): string {
  if (err instanceof MissingKeyError) return "Claude API: ANTHROPIC_API_KEY is not set";
  if (err instanceof Anthropic.AuthenticationError) return "Claude API: authentication failed (check ANTHROPIC_API_KEY)";
  if (err instanceof Anthropic.PermissionDeniedError) return "Claude API: permission denied for this key";
  if (err instanceof Anthropic.NotFoundError) return "Claude API: model not found (check LLM_MODEL)";
  if (err instanceof Anthropic.RateLimitError) return "Claude API: rate limited, try again in a moment";
  if (err instanceof Anthropic.OverloadedError) return "Claude API: overloaded, try again";
  if (err instanceof Anthropic.BadRequestError) return `Claude API: bad request (${clip(err.message, 140)})`;
  if (err instanceof Anthropic.InternalServerError) return `Claude API: server error ${err.status}`;
  if (err instanceof Anthropic.APIConnectionTimeoutError) return "Claude API: request timed out";
  if (err instanceof Anthropic.APIConnectionError) return "Claude API: connection failed";
  if (err instanceof Anthropic.APIError) return `Claude API: error ${err.status ?? ""}`.trim();
  return `${fallbackPrefix}: ${clip(err instanceof Error ? err.message : String(err), 140)}`;
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

// ── Line splitter ─────────────────────────────────────────────────────────────

/** Splits a text stream into complete lines. Chunks may cut lines anywhere; CRLF is accepted. */
export class LineSplitter {
  private buf = "";

  push(chunk: string): string[] {
    this.buf += chunk;
    const parts = this.buf.split("\n");
    this.buf = parts.pop() ?? "";
    return parts.map(stripCr);
  }

  /** The trailing line without a newline, if any. */
  flush(): string[] {
    const rest = stripCr(this.buf);
    this.buf = "";
    return rest.trim() ? [rest] : [];
  }
}

function stripCr(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

// ── Line classification ───────────────────────────────────────────────────────

/** `repaired`: the line only parsed after repairBrackets (counted in usage.repaired_lines). */
export type ComposerLine =
  /** Blank line or a markdown fence the model added by accident: dropped, not counted. */
  | { kind: "ignore" }
  | { kind: "a2ui"; msg: A2uiMessage; repaired?: true }
  | { kind: "data"; source: string; args: JsonObject; into: string; repaired?: true }
  | { kind: "caption"; text: string; repaired?: true }
  /** Counted in usage.skipped_lines. */
  | { kind: "invalid"; reason: string };

const FENCE_ONLY = /^```[\w-]*$/;
const KINDS = new Set<string>(A2UI_MESSAGE_KINDS);

/**
 * `repair: false` for a line that may have been cut off (the unterminated last line after a
 * max_tokens stop): such a line must parse as written or it is skipped.
 */
export function classifyLine(raw: string, opts: { repair?: boolean } = {}): ComposerLine {
  let line = raw.trim();
  if (!line || FENCE_ONLY.test(line)) return { kind: "ignore" };
  // A fence glued to the object: ```json{"a2ui":...} or {...}```
  line = line.replace(/^```[\w-]*\s*/, "").replace(/\s*```$/, "");
  if (!line) return { kind: "ignore" };
  if (!line.startsWith("{")) return { kind: "invalid", reason: "not a JSON object" };
  let obj: unknown;
  let repaired = false;
  try {
    obj = JSON.parse(line);
  } catch {
    const fixed = opts.repair === false ? null : repairBrackets(line);
    if (fixed === null) return { kind: "invalid", reason: "invalid JSON" };
    try {
      obj = JSON.parse(fixed);
      repaired = true;
    } catch {
      return { kind: "invalid", reason: "invalid JSON" };
    }
  }
  const c = classifyObject(obj);
  return repaired && c.kind !== "invalid" && c.kind !== "ignore" ? { ...c, repaired: true } : c;
}

function classifyObject(obj: unknown): ComposerLine {
  if (!isPlainObject(obj)) return { kind: "invalid", reason: "not a JSON object" };

  if ("a2ui" in obj) {
    const msg = checkEnvelope(obj.a2ui);
    return msg ? { kind: "a2ui", msg } : { kind: "invalid", reason: "bad A2UI envelope" };
  }
  if ("data" in obj) {
    const d = obj.data;
    if (!isPlainObject(d) || typeof d.source !== "string" || typeof d.into !== "string") {
      return { kind: "invalid", reason: "bad data line" };
    }
    // "/" would replace the whole data model, wiping the inputs' values.
    if (!d.into.startsWith("/") || d.into === "/") return { kind: "invalid", reason: "data.into must be a path like /results" };
    const args = isPlainObject(d.args) ? (d.args as JsonObject) : {};
    return { kind: "data", source: d.source, args, into: d.into };
  }
  if ("caption" in obj) {
    return typeof obj.caption === "string" && obj.caption.trim()
      ? { kind: "caption", text: obj.caption.trim() }
      : { kind: "invalid", reason: "bad caption" };
  }
  // Lenient: a bare A2UI message without the {"a2ui": ...} wrapper.
  const bare = checkEnvelope(obj);
  return bare ? { kind: "a2ui", msg: bare } : { kind: "invalid", reason: "unknown line kind" };
}

/**
 * Fixes the one mistake the composer makes on long lines without thinking: a miscounted run of
 * closing brackets at the very end of a deeply nested line (one too many, or a "]" left out).
 * Only that final run is rebuilt, and only when it is off by at most two characters; anything
 * else (a mismatch earlier in the line, a line cut off mid-structure) returns null and stays invalid.
 */
export function repairBrackets(line: string): string | null {
  const tailMatch = /[\]}\s]*$/.exec(line);
  const tailStart = tailMatch ? tailMatch.index : line.length;
  const body = line.slice(0, tailStart);
  const tail = line.slice(tailStart).replace(/\s+/g, "");
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (const ch of body) {
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return null;
    }
  }
  if (inString || stack.length === 0) return null;
  const needed = stack.reverse().join("");
  if (needed === tail || tail.length < 3 || Math.abs(needed.length - tail.length) > 2) return null;
  return body + needed;
}

/** Light check only (the client validates fully): version "1.0", exactly one known key, an object with a surfaceId. */
export function checkEnvelope(v: unknown): A2uiMessage | null {
  if (!isPlainObject(v) || v.version !== A2UI_VERSION) return null;
  const keys = Object.keys(v).filter((k) => k !== "version");
  if (keys.length !== 1 || !KINDS.has(keys[0])) return null;
  const body = v[keys[0]];
  if (!isPlainObject(body) || typeof body.surfaceId !== "string") return null;
  return v as A2uiMessage;
}

// ── HTML fence stripping (html mode) ──────────────────────────────────────────

/**
 * Drops markdown fence lines (```html ... ```) from a streamed HTML document while still
 * forwarding everything else as soon as it arrives. Only the start of a line that could
 * still become a fence is held back.
 */
export class FenceStripper {
  private line = "";
  /** The current line is known not to be a fence and has been forwarded. */
  private passthrough = false;

  push(text: string): string {
    let out = "";
    for (const ch of text) {
      if (this.passthrough) {
        out += ch;
        if (ch === "\n") this.passthrough = false;
        continue;
      }
      this.line += ch;
      if (ch === "\n") {
        if (!isFenceLine(this.line)) out += this.line;
        this.line = "";
        continue;
      }
      const t = this.line.trimStart();
      if (t && !"```".startsWith(t.slice(0, 3))) {
        out += this.line;
        this.line = "";
        this.passthrough = true;
      } else if (t.length > 3 && !/^```[\w-]*\s*$/.test(t)) {
        // ``` followed by something that is not a language tag: real content.
        out += this.line;
        this.line = "";
        this.passthrough = true;
      }
    }
    return out;
  }

  end(): string {
    const rest = this.line;
    this.line = "";
    this.passthrough = false;
    return isFenceLine(rest) ? "" : rest;
  }
}

function isFenceLine(line: string): boolean {
  return /^\s*```[\w-]*\s*$/.test(line);
}
