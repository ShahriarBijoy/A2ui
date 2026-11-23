# NOTES — verified facts, rulings, measurements

Read this before calling any external API. Items here override PLAN.md where they differ (PLAN.md §0.2).

## Verified against live docs / live calls (2026-11-23)

### Jev (TypeSafe System One)
- Endpoint: `POST https://api.typesafe.ai/v1/systemone`, header `Authorization: Bearer <JEV_API_KEY>`, JSON body `{model, state, questions}`.
- Model: `jev-latest` (currently resolves to `jev-1.14.0`). `GET /v1/models` lists `jev-latest`, `jev-preview`.
- `state`: string | object | array. Questions are keyed by name; names are NOT sent to the model, so instructions must be self-contained.
- Choice: `{type:"choice", instructions, criteria:{key: description}}` (1..255 options) → `{type:"choice", choice, confidence, probabilities:{key: p}}`.
- Noul: `{type:"noul", instructions, criteria?:{"true": ..., "false": ...}}` → `{type:"noul", noul: 0..1}`.
- Score: criteria is an ordered array (1..10 levels) → `{score, confidence, probabilities, legend}`.
- Response: `{model, answers, usage:{input_tokens, output_tokens}}`. Output tokens are free.
- Errors: 400 rule violation, 401 bad key, 422 validation (body has `detail`), 429 rate limit, 529 overloaded (retry with backoff). No streaming.
- Latency (measured from a dev machine in Germany): cold first call ~1.1 s (TLS handshake). Warm (keep-alive): **150–190 ms** for a 3-question route request (849 input tokens), ~160 ms for one question. The 800 ms router budget holds with a warm connection.

### Jev knob design (spike results, 10 lines × 3 variants)
- **Do not include the current value as an option** next to `unchanged`: the mass splits (e.g. 0.18 / 0.18) and nothing clears 0.6.
- **Relative words** ("later", "earlier", "a bit more") give a direction, not a magnitude. Adding this instruction fixes it:
  "If the speaker only says later or earlier without a time, pick one hour later or earlier." → "we're six, and later" gives guests 6 @0.98, time 20:00 @0.91.
- Labeling options with their relation to the current value ("20:00 (1 h later)") alone did NOT fix "later" (0.32).
- "two more people" with current 4 → 6 @1.0 (relative arithmetic works).
- Negatives route correctly: "book it" new@1.0, "sounds good" new@0.92, "actually I need a flight instead" new@0.8, "what about Italian?" new@0.44 (low but not edit → compose).
- **Partial-edit rule:** if a knob's P(unchanged) is low (the speaker asked to change it) but no option clears 0.6, compose. Never patch half an edit.

### Claude API
- SDK: `@anthropic-ai/sdk` 1.12.0. Use `client.messages.stream(...)`.
- Model ids (exact, no date suffix): `claude-haiku-5-5` (smallest; $0.10/$0.50 per MTok), `claude-sonnet-5-5`, `claude-opus-5-5`.
- PLAN says "try the smallest model first": default `LLM_MODEL=claude-haiku-5-5`, move up only if scenarios fail. (The user's spec overrides the SDK skill's Opus default.)
- Haiku 5.5: thinking is ON by default (adaptive). `thinking: {type: "disabled"}` is accepted only at effort `high` or below. Default effort `medium`.
- Do NOT send `temperature`/`top_p`/`top_k` (400 on API version 2026-10-21). No assistant prefill (400). Forced `tool_choice` any/tool is rejected on Opus 5.5 / Sonnet 5.5: use `tool_choice: {type: "auto"}` for widgets mode.
- Prompt caching: put `cache_control: {type:"ephemeral"}` on the static system block. STATE and THREAD are volatile and go AFTER the breakpoint (in the user message), never inside the cached system text. Verify `usage.cache_read_input_tokens > 0` on the second call. Minimum cacheable prefix is model-dependent (512–4096 tokens).

### A2UI (github.com/google/A2UI, specification/v1_0)
- Wire format in PLAN §2 matches upstream v1.0: `{"version":"1.0", <one key>}`, `@path`, `@call`, `@checks`, `{path, componentId}` templates, `updateDataModel` with `value: null` deleting.
- Upstream README now says **"This specification is stable"** (v1.0, formerly v0.10). PLAN §9.3 says to call it "A2UI v1.0 candidate" — **tell the speaker; the line should probably become "A2UI v1.0"**.
- Upstream `error` message also carries `path` (JSON Pointer to the failing field). Included in our types.

### Soniox
- Real-time model: **`stt-rt-v6`** (v5 deprecated, removed 2026-12-15).
- Temporary key: `POST https://api.soniox.com/v1/auth/temporary-api-key`, `Authorization: Bearer <SONIOX_API_KEY>`, body `{"usage_type":"transcribe_websocket","expires_in_seconds":60}` (+ optional `single_use`, `max_session_duration_seconds`, `client_reference_id`). The long-lived key needs the "Temporary API keys" permission.
- Manual finalization: send `{"type":"finalize"}`; all audio so far comes back `is_final: true` and a `<fin>` token marks completion. Send ~200 ms of trailing audio/silence before finalizing. Billed for full stream duration.
- Browser SDK: docs at https://docs.soniox.com/sdk/web-SDK (npm `@soniox/speech-to-text-web` is at 1.4.0; confirm the package name on that page before use).

### Cloudflare
- Cloudflare Vite plugin 1.70.1 works (dev server runs the Worker in workerd). `run_worker_first: ["/api/*", "/catalog/*"]`, SPA fallback for everything else.
- Wrangler is currently logged into the WRONG account. Deploy only after `wrangler whoami` shows the owner's personal account; then pin `account_id` in wrangler.jsonc.

### Tooling
- TypeScript 7.0.2: `baseUrl` is removed; `paths` resolve relative to the tsconfig.
- shadcn: `bunx --bun shadcn@latest init -t vite -b radix -p nova --no-monorepo -y` (style `radix-nova`), components via `shadcn add ... -y`.
- Vite 8.3, Tailwind 4.3, Hono 4.13, React 19.3, Bun 1.3.8.

## Rulings (decisions made without asking)
- Fonts: Geist + Geist Mono, bundled via fontsource (no network at the venue). PLAN says "system sans": same intent, consistent rendering on the stage machine.
- Catalog id: `<origin>/catalog/brick-box/v1`, served publicly as JSON by the Worker. The processor accepts any catalogId ending in `/catalog/brick-box/v1`.
- `a2ui` SSE events carry an extra `origin: "llm" | "data" | "knob"` so the wire log can show who wrote each message.
- "Demo data" badge: shown when any record in a surface's data model has `demo: true` (no model cooperation needed).
- Pool tile count = session use count; "used" fill = accepted in the current turn.

## Measurements
(Filled in by steps 7, 10 and 13.)

## Prompt changes log
(Step 7.)
