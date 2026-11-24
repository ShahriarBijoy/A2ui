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
- **Browser SDK is `@soniox/client`** (PLAN's `@soniox/speech-to-text-web` is superseded). Docs: https://docs.soniox.com/sdk/web-SDK.mdx. Usage: `new SonioxClient({ config: async () => ({ api_key }) })`, `client.realtime.record({ model: "stt-rt-v6", ... })`, `recording.on("result", r => r.tokens)`, `recording.on("error", ...)`, `await recording.stop()` (graceful, waits for finals). Installed.

### Cloudflare
- Cloudflare Vite plugin 1.70.1 works (dev server runs the Worker in workerd). `run_worker_first: ["/api/*", "/catalog/*"]`, SPA fallback for everything else.
- Wrangler is logged into the owner's personal account; `account_id` 6b865b6e74012e0c96ada7e531e8cc9e is pinned in wrangler.jsonc.

### Tooling
- TypeScript 7.0.2: `baseUrl` is removed; `paths` resolve relative to the tsconfig.
- shadcn: `bunx --bun shadcn@latest init -t vite -b radix -p nova --no-monorepo -y` (style `radix-nova`), components via `shadcn add ... -y`.
- Vite 8.3, Tailwind 4.3, Hono 4.13, React 19.3, Bun 1.3.8.

## Owner direction (2026-11-23)
- **No fixed data, no scripted flows.** `places.json` and the `places` data source were removed (7ca485c, 0b4dcff). Real-world facts come from live web search (`search` data lines; Haiku 5.5 + `web_search_20250305`, max_uses 1, ≤3 searches per turn, 12 s timeout, null for unknown fields, source URL per record). Flights remained a demo generator (badged) pending the owner's choice; superseded 2026-11-24, see "Flights from live web search".
- Live a2ui (phase 2, dev machine): first UI 0.6–0.9 s; data 4–6 s; 19 searches, 0 failures. `web_search_20260209` is unusable with Haiku 5.5 (invalid_tool_input 5/6, one 99 s run).
- Query time context (32b33da): queries now name the day and time; whether that improves "open at that hour" is **unproven/partial** (Wed-clock probe 3/6 → 4/7 open per own sources, within noise; 3/7 still contradicted). Don't claim it as a fix.
- Smoke held-out lines (first version) were reconstructed from summaries; exact intended wording: "Plan a 3-day trip to Lisbon in March", "Compare two phone plans for me", "I want to adopt a dog, what do I need?", "Help me pick a gift for my mum, budget 50 euros", "Book a haircut for Saturday morning".
- Known quality limits: some sources are yelp search pages (3/25 rows); a place closing at 17:00 can appear for "dinner" when the query lacks a time; walk_min is null in practice (25/25), since sources rarely state walking time.

## Composer model A/B (2026-11-23, local, DEV_NOW=2026-11-25T18:45, HEAD 8918fc0, 10 runs per main scenario)
| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Main runs | 13/20 (dinner 10/10, flight 3/10) | 14/20 (dinner 5/10, flight 9/10) |
| Seat map after flight pick | 0/10 | 10/10 |
| First UI median / p90 | 1.45 / 2.03 s | 1.72 / 2.33 s |
| Screen done median / p90 | 2.28 / 2.71 s | 3.91 / 5.07 s |
| Output tokens median | 632 | 685 |
| Held-out ×2 | 10/10 | 9/10 |
- **Ruling: composer → claude-sonnet-5-5** (PLAN §3.6: "move up only if the scenarios fail"; Haiku ignores the generic seat/Button rules). Sonnet's dinner misses were the router (a separate date-only Day input claimed "later"), which is being fixed in knobs.ts. Search, widgets and html stay on Haiku. Thinking: Sonnet `between_tools` (84/84 turns ran it), Haiku `disabled` (73/73).

## Main scenarios at the talk's clock (2026-11-23 ~23:55, local dev, DEV_NOW=2026-11-25T18:45, HEAD 615d559, composer claude-sonnet-5-5, 10 runs each)
- **19/20 scenario runs pass (95%).** Flight 10/10 on every step, seat map included. Dinner 9/10; the one miss is a step-2 screen with 8 visible blocks (rule ≤ 7).
- Per step (median): dinner opening first UI 1.87 s, screen 4.23 s, live data 5.49 s (search 3.0 s, 1–3 records); tap place 1.44 / 4.66 s; **"We're six, and later." patch 203 ms (decision model, no LLM)**; confirm 1.53 / 2.85 s; flight opening 1.33 / 3.89 s; "To New York, give me options" 2.21 / 5.16 s (4 demo flights); tap flight → seat map 1.68 / 4.29 s; confirm seat 1.66 / 2.82 s.
- Widgets: dinner → RestaurantWidget with 5 live places in 4.22 s; flight → FlightSearchWidget 0.86 s. HTML: first byte ~0.5–0.6 s, done 4.5–5.6 s.
- Full table: scratchpad `main-10x-sonnet.md`. Production smoke (all lines) should be re-run during the evening before the talk (18:30–19:30), since dinner results depend on the real clock.

## Production smoke (615d559, Sonnet composer, real clock ~00:05 Tue 24 Nov; scripts/smoke-results.md)
- Flight 3/3 on every step. Pink 3/3. Widgets 5/5. HTML 6/6.
- Dinner: the opening step passed 3/3, but live search found 0/3/0 places (past midnight, kitchens closed), so 2 runs had nothing to tap. The run with places passed every step ("We're six, and later" patched in 219 ms). Re-run in the evening.
- Wildcards 7/9, held-out 13/15. **Every miss is a 8–9-block screen** (rule ≤ 7); Sonnet builds richer screens. Cosmetic; the prompt is frozen for the talk.
- First UI on production with Sonnet: ~1.4–2.3 s (Haiku ~0.7–0.9 s); screen done ~3.7–6.7 s.

## Production main scenarios after the spend-limit raise (787b35e, real clock ~01:25 Tue 24 Nov, 3 runs each, patch judged by result)
- **6/6 scenario runs pass (100%).** Every step 3/3: dinner (places 2/4/1), tap place, **"We're six, and later." patch 173 ms (146–175)**, confirm; flight form, "To New York" (4 demo flights), tap flight → seat map, confirm.
- Medians: dinner first UI 1.73 s / screen 3.32 s / live data 5.63 s; flight first UI 1.59–2.34 s / screen 4.0–5.1 s. Widgets: RestaurantWidget with 5 live places in 4.03 s; FlightSearchWidget 0.84 s. HTML: first byte ~0.55 s.
- Direct turns: dinner first UI 0.96 s, data 5.6 s (Bellissima Überseestadt, Restaurant Übersee); concerts in Hamburg data 6.3 s (5 real acts); dog 4.7 s, no search.

## Flights from live web search (owner decision 2026-11-24; branch flights-web)
Setup: the Hono app served in-process by Bun (dev server off for memory), wrangler.jsonc vars + .dev.vars keys,
DEV_NOW=2026-11-25T18:45, composer claude-sonnet-5-5, search/widgets/html claude-haiku-5-5;
`bun run smoke http://localhost:5199 --only flight --runs 10 --strict`. Bar (brief): a run passes when steps 1-3 meet
their expected bricks (`--strict`) and step 2 shows at least 1 OptionCard drawn from data with a title (smoke "options N").
- The demo generator (data/flights.ts, source "flights") is gone. A "flights" data line is skipped like any unknown source.
  Cards are carrier · route · fare as a result lists it (+ tags saying what the fare is); no times, no computed price.
- Search probes (Haiku + web_search, query "flights from Bremen to New York on Thursday 26 November 2026", fields
  carrier/route/price/tags, max 4; ~2.5-3.6 s each, 1 search each):
  - first travel rule, 3 runs: 11 records; 10/11 prices carried notes in parentheses ("460 € pro Person (round trip, Nov. 26
    outbound)"); 2/11 had carrier null (blank card title).
  - "price is only the amount" + carrier rule, 4 runs: 15 records; 1 price with parentheses; 2 carrier null.
  → a requested `carrier` is now required server-side (normalizeRecords drops the item).
  - final wording (e774dbe), 4 runs, carrier-less items already dropped: 11 records; 2 prices still with parentheses
    (Haiku noise; values are shown as returned).

| prompt version | runs passing the bar | step 1 form (no data line) | step 2 options ≥1 | step 3 SeatMap | step 4 confirm | records per run | search ms median (min-max) | data arrived median (min-max) |
|---|---|---|---|---|---|---|---|---|
| vA f01bcef | **3/10** | 10/10 (0 fetches in 10/10) | 10/10 | **3/10** | 10/10 | 4,4,4,3,2,4,4,3,3,3 | 2755 (2466-3139) | 4.80 s (4.41-6.06) |
| vB e774dbe | **10/10** | 10/10 (0 fetches in 10/10) | 10/10 | 10/10 | 10/10 | 3,3,3,3,1,3,1,2,3,2 | 2514 (1918-2959) | 5.00 s (3.97-5.71) |
| vC 9af6f6d | **10/10** | 10/10 (0 fetches in 10/10) | 10/10 | 10/10 | 9/10 | 2,4,1,2,4,3,3,2,2,3 | 2551 (1884-3169) | 5.02 s (4.12-6.15) |
- vC (shipped prompt) only replaces the travel rule's price examples ("from €605", "€460", which were the route's real
  fares) with the price hint's neutral "from €39", "€25". Its 4 probe runs still returned 460 € and from 605 €
  (10 records, 2 prices with parentheses), as the very first probe did before any price example: web values, not echoes.
  vC step 4 miss (run 8): the seat step's Button was named pick_seat, so the smoke found no confirm_ action (not in the bar).
  vC step 2 skipped 1 prose line in 7/10, repaired 0; step 1 skipped 1 in 1/10. Every step-2 line made 1 web search (10/10);
  2 searches dropped 1 item each. vC timings (median, min-max): step 1 first UI 1.64 s (1.45-2.38), screen 4.12 s;
  step 2 first UI 2.49 s (1.59-2.91), screen 4.93 s; tap → seat map 1.73 / 4.28 s; confirm 1.75 / 2.86 s.
- vA failure cause (7/10): after pick_flight the composer built a confirm or passengers step (Stepper, Stat) instead of a
  seat pick; a fare listing has no times, so it no longer read as a booking with assigned seats. vB adds to rule 11:
  "A flight is such a booking: picking a flight leads to its seat step." No other failures in vA or vB.
- Every step-2 data line made exactly 1 web search (20/20). Step 2 composer lines: vB skipped 1 prose line in 5/10 and
  repaired 1 line in 2/10 (vA: skipped 3/10, repaired 1/10), none affecting the screen. The search dropped 1 item in 2 vB
  runs (carrier rule or source check).
- vB timings (median, min-max): step 1 first UI 1.58 s (1.43-2.45), screen 4.22 s; step 2 first UI 1.84 s (0.86-2.58),
  screen 4.60 s; tap → seat map first UI 1.66 s, screen 4.01 s; confirm 1.54 / 2.57 s.
- Typical cards (vC run 7, shipped as F4-F6; search 2637 ms): Lufthansa · BRE → NYC · 1 stop · from 605 € [flight,
  economy, Nov 26 fare]; Air France · BRE → JFK · 1 stop · 460 € [flight, round trip, Nov 26 outbound]; KLM · BRE → JFK ·
  1 stop · from EUR590 [flight, round trip, Nov fares]. Sources: lufthansa.com, skyscanner.de, klm.de. Fares are as
  listed, not bookable quotes.
- Widgets: smoke's widgets line ("I need to book a flight tomorrow.", no destination) → vA a text answer, vB
  FlightSearchWidget in 754 ms (form only, no search). Manual 2-turn chains (that line, then "To New York, give me
  options."), 3 each: at e774dbe the widgets model left "from" empty in 2/3 second turns (no search, no rows). Since
  ec22ba1 the origin defaults to the venue's city: second turn 3/3 FlightSearchWidget with 2/4/4 web rows, search
  2342/2902/3265 ms, widget at 3.37/4.09/4.03 s; first turn 2/3 the form (From Bremen, Day 26 Nov), 1/3 a text question.
- HTML flight line: 1/1 in both versions (unchanged path).

## Rulings (decisions made without asking)
- Fonts: Geist + Geist Mono, bundled via fontsource (no network at the venue). PLAN says "system sans": same intent, consistent rendering on the stage machine.
- Catalog id: `<origin>/catalog/brick-box/v1`, served publicly as JSON by the Worker. The processor accepts any catalogId ending in `/catalog/brick-box/v1`.
- `a2ui` SSE events carry an extra `origin: "llm" | "data" | "knob"` so the wire log can show who wrote each message.
- "Demo data" badge: shown when any record in a surface's data model has `demo: true` (no model cooperation needed).
- Pool tile count = session use count; "used" fill = accepted in the current turn.

## Measurements (dev machine in Germany → Anthropic/TypeSafe; local wrangler dev; 2026-11-23)
These are dev-machine numbers. The talk numbers come from step 13 against the deployed Worker.

### Composer (claude-haiku-5-5, warm prompt cache, `thinking: {type: "disabled"}`)
- First UI 618–888 ms, compose 1.2–2.7 s on all six opening lines, 0 skipped lines.
- Cache: the static system prompt is ~4.6–5.0k tokens; every call after the first reads it (`cache_read_tokens` ≈ 4.6–5.0k).
- Thinking comparison (first UI / compose / output tokens, ms):

| line | disabled | adaptive + effort low | default adaptive (medium) |
|---|---|---|---|
| dinner | 902 / 1996 / 455 | 834 / 1897 / 427 | 2538 / 3889 / 858 |
| flight | 715 / 2463 / 699 | 738 / 2554 / 706 | 2733 / 4466 / 1144 |
| bill | 764 / 2307 / 565 | 4197 / 5879 / 1325 | 5204 / 6753 / 1514 |
| packing | 685 / 2707 / 758 | 4246 / 6556 / 1492 | 3990 / 6219 / 1495 |
| quiz | 673 / 2249 / 563 | 4458 / 5659 / 1308 | 3146 / 4618 / 1050 |
| pink | 814 / 1383 / 224 | 777 / 1704 / 326 | 727 / 1523 / 262 |

  → **Chosen: thinking disabled** (accepted on Haiku 5.5). Fallback: if the API rejects it before output, the call reruns once with adaptive + low.
- Scenario runs with the final prompt (bcacf04, text + taps, decision off): dinner 2/2, flight 4/4 (24 turns). Earlier prompt versions: dinner 8/8, flight 5/6; the one failure was a caption-only confirm, now retried once.
- Real output replayed through the client processor: **0 refused, 0 validation errors** over 54 turns (203 messages). One earlier refusal (`"rows": {"literal": 20}`) was fixed in the prompt.
- Dinner line event timing (one run): createSurface 828 ms → places data 969 ms → components 1511 ms → OptionCard template 2010 ms → caption 2139 ms.

### Decision model (Jev, jev-1.14.0)
- Route (warm): median ~154 ms. "We're six, and later" → patch time ["20:00"] + guests 6 in 156–199 ms; all events at 228 ms; no LLM call, no usage event.
- Cold: first call 810 ms (over the 800 ms budget) → `warmJev` (GET /v1/models): cold warm-up 214–311 ms, the next route 247 ms. **Wire /api/warm on page load and Space-down.**
- Live eval: 30/30 lines routed correctly (edits patch; "book it", "confirm", "sounds good", "flight instead", "to New York, give me options" compose). Tightest call: "a different place for six people", new 0.50 vs edit 0.49 (composed).
- Prediction: median ~153–164 ms. After rewording, "I need to book a flight and choose my seat" lights 3 bricks (ChoicePicker, DateTimeInput, SeatMap 0.80), down from 11; prefixes of 3/5/7 words light 0/0/1. Live calls stay on (median < 500 ms).

### Other modes
- Widgets (live, phase 3): dinner → RestaurantWidget with 5 real places from live search 5/5 (search 2.7–3.6 s, total 3.6–4.5 s); bill split → plain text 2/2. (Earlier fixed-data number of 734 ms is obsolete.) Flight → FlightSearchWidget with 4 demo flights.
- HTML: "make the page pink and add a login box": first byte 652 ms, compose 2.9 s, 710 output tokens, obeyed. In a2ui the same line → "Not available" card with alternatives.
- Client disconnect mid-stream ends the Worker invocation within ~720 ms; the next turn works.

### Production (Cloudflare Worker, https://brick-box.shahriarbijoy.workers.dev, deployed 2026-11-23 from bb688f2; probe from Germany)
- /api/health: 401 without the key, 200 with it; all three API keys present.
- Router (dinner screen, "We're six, and later."): **first (cold) call 153 ms**, then 144 / 138 / 141 ms; whole turn (SSE, route + 2 knob patches + caption + done) 166–209 ms; patch decision on 4/4 with Time → 20:00, Guests → 6. → The 810 ms cold call happened only from the dev machine. **No /api/warm needed** (warmJev stays available, unwired).
- Compose (dinner line, decision off, first call after deploy, cache cold): first UI 751 ms, compose 1.92 s, 472 output tokens.

### Production with live data (deployed fb43969, 2026-11-23 ~22:16, probe from Germany; first event times are client-observed)
| line | first UI | screen + caption | live data | search ms | records |
|---|---|---|---|---|---|
| dinner after this event, nearby | 939 ms | 2.31 s | 4.96 s | 3443 | 3 (Restaurant Feuerwache, Blaufeuer, Restaurant Elisa) |
| concerts in Hamburg next month | 669 ms | 1.96 s | 5.10 s | 3804 | 5 |
| adopt a dog, what do I need | 706 ms | 2.40 s | (no search) | – | – |
Prompt cache read 5193 tokens after the first call.

### Composer behaviours that differ from PLAN (lane W rulings, under review)
- A data line written before createSurface waits and attaches to the new surface (the PLAN-literal rule put the flight list on the old form).
- Lines with miscounted closing brackets are repaired, and repairs are not counted as skipped.
- A caption-only answer (no screen) is retried once; usage sums both calls; if there is still no screen, the client gets usage and then an error.

## Prompt changes log
(Step 7.)
