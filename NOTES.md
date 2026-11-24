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

## Cloudflare free plan and rate limits (docs fetched 2026-11-24)
- Workers Free: 100,000 requests/day, reset at midnight UTC, Error 1027 after; 10 ms CPU per request; 50 subrequests per request.
- "Requests to static assets are free and unlimited" (pricing page). With `run_worker_first: ["/api/*", "/catalog/*"]` only those paths run the Worker.
- Rate Limiting binding (`ratelimits` in wrangler.jsonc, wrangler ≥ 4.36; we run 4.166): `limit({key})` → `{success}`; periods 10 or 60 s only; approximate and local to each Cloudflare location. A strict or daily cap would need a Durable Object (Free plan: SQLite-backed DOs only). Ruling: binding only, no DO two days before the talk (advisor).
- Rate-limited and unauthorized requests still count toward the 100k/day (the Worker ran). The limiter protects the Claude/Soniox spend, not the request count.

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
- vC (9af6f6d) only replaces the travel rule's price examples ("from €605", "€460", which were the route's real
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
- Typical cards (vF a94ccbf run 1, shipped as F4-F6 since fix round 2; search 2700 ms): Lufthansa · BRE → NYC · 1 stop
  · from 605 € [round trip, economy]; Air France · BRE → JFK · 1 stop · 460 € [round trip, 1 stop]; KLM · BRE → JFK ·
  1 stop · from EUR590 [round trip, economy]. Sources: lufthansa.com, skyscanner.de, klm.de. Fares are as listed, not
  bookable quotes; the round-trip readings are Haiku's and unverified (lufthansa.com and klm.de could not be fetched).
  (Until fix round 2, F4-F6 were vC 9af6f6d run 7, whose Lufthansa card had no round-trip tag.)
- Widgets: smoke's widgets line ("I need to book a flight tomorrow.", no destination) → vA a text answer, vB
  FlightSearchWidget in 754 ms (form only, no search). Manual 2-turn chains (that line, then "To New York, give me
  options."), 3 each: at e774dbe the widgets model left "from" empty in 2/3 second turns (no search, no rows). Since
  ec22ba1 the origin defaults to the venue's city: second turn 3/3 FlightSearchWidget with 2/4/4 web rows, search
  2342/2902/3265 ms, widget at 3.37/4.09/4.03 s; first turn 2/3 the form (From Bremen, Day 26 Nov), 1/3 a text question.
- HTML flight line: 1/1 in both versions (unchanged path).

### Fix round 1 (2026-11-24 ~03:15-03:27): no talk values in prompts, re-evaluated (flight, dinner, held-out)
Same setup (in-process Bun Worker, DEV_NOW=2026-11-25T18:45, Sonnet composer, Haiku search). Flight judged with `--strict`;
dinner and held-out with the default judge (expected bricks informational; the options and patch checks always on).
- f35faaa: search prompt without talk values (route example "OPO → OSL · 1 stop via AMS", tag example "June fares");
  tests guard the search and composer prompts against Bremen/New York/JFK/BRE/FRA/Lufthansa/Air France/KLM/Nov/November.
- d7a9e70: runSearch asks once more after an answer in prose ("not a JSON array") or an empty list when `carrier` is
  requested (trips); thrown errors, refusals and a client that left are not retried; searches and tokens are summed.

| version | runs passing the bar (strict) | smoke scenario runs (all 4 steps) | step 2 options ≥1 | step 3 SeatMap | step 4 confirm | records per run (mean) | step-2 search ms median (min-max) | data arrived median (min-max) |
|---|---|---|---|---|---|---|---|---|
| vD f35faaa | **8/10** | 8/10 (36/42 lines) | 8/10 | 8/10 (2 not reachable) | 8/10 | 0,3,4,2,1,3,2,1,0,2 (1.8) | 2365 (1665-2954) | 4.86 s (3.85-6.10) |
| vE d7a9e70 | **10/10** | 10/10 (42/42 lines) | 10/10 | 10/10 | 10/10 | 3,3,4,3,2,3,3,2,2,2 (2.7) | 2606 (2144-3069) | 5.19 s (4.37-6.08) |
- vD misses, both at the search (same query as every run): run 1 "answer was not a JSON array" (Haiku answered in
  prose), run 9 an empty list (0 records, nothing dropped). No list → no pick target → steps 3-4 not run.
- 32 direct probes of the same search prompt at f35faaa (probe2, Haiku): 32/32 returned 1-4 carriers (mean 2.75),
  2.36-3.80 s. Misses are occasional (2 of 42 searches at f35faaa), hence the retry rather than a prompt change.
- vE: every step-2 data line succeeded on its first call (10/10 fetches with 1 web search and ≥1 record; the retry
  never fired). Step 1 sent no data line in 10/10. Step 2 skipped 1 prose line in 7/10, repaired 0; steps 1, 3, 4 0/0.
  vE medians: step 1 first UI 1.68 s, screen 4.20 s; step 2 first UI 2.28 s, screen 4.74 s; tap → seat map 1.77 /
  4.01 s; confirm 1.63 / 2.96 s. Widgets flight line: FlightSearchWidget 903 ms (no destination, no search). HTML 1/1.
- Records-per-run mean by version (measured above): vA 3.4, vB 2.4, vC 2.6, vD 1.8, vE 2.7.
- Card quality seen in vE (shown as returned): run 6 route values carried comments ("BRE → NYC · round trip, not
  Thursday-specific"); run 5 prices kept parentheses ("460 € (round trip, Nov. 26 outbound)"); run 8 returned
  "BRE → NYC · 1 stop via FRA" with no such example in the prompt any more.
- **Dinner ×3 (vE, default judge): 3/3 scenario runs, 14/14 lines.** Places 2, 1, 2 (search 2945/2117/2445 ms, 1 web
  search each; e.g. The Grill Upper River, RIVA, Bellissima Überseestadt, Restaurant Feuerwache); first UI 1.90 s,
  data 4.92 s (median). "We're six, and later." patched 3/3, judged by result: guests 2 → 6, time 20:00 → 21:00 (+60 min,
  same date), nothing else changed, 158/176/409 ms, no LLM. Step 2 expect 2/3 (run 2 used a time DateTimeInput, no
  ChoicePicker; informational). Widgets: RestaurantWidget with 5 places in 3.95 s. HTML 1/1.
- **Held-out ×1 (vE, default judge): 4/5.** Lisbon PASS (a planning form: Destination, Start date, Days, Pace; no
  From/To trip-search form, no search), phones PASS, gift PASS (search 4119 ms, 5 records), haircut PASS; dog FAIL:
  9 visible blocks (rule ≤ 7), the known cosmetic miss.
- F4-F6 stayed vC run 7 in this round (route values "BRE → NYC · 1 stop", "BRE → JFK · 1 stop" ×2; no "via FRA");
  replaced in fix round 2.

### Fix round 2 (2026-11-24 ~03:30-03:36): review I4/I5 rulings, measured once on the final code a94ccbf
- 278be44 tidies live records without adding facts (review I4): tags lose the generic "flight", duplicates (any case),
  and a one-way label next to a round-trip label (both dropped); prices lose bracketed notes and trailing per-person
  words (amount, currency and a leading "from" stay as written; a round-trip/one-way label stated only in the note
  moves to the tags); trip results keep the first card per carrier, before the item cap.
- a94ccbf: composer rule 11 adds "A SeatMap shows a generic cabin: no "taken" seats (seat availability is unknown) and
  no preselected seat (initial value ""); its confirm Button keeps a required check on the seat." (review I5); widget
  empty text "No flights to show." (M3); flights.ts header (M2).

| version | runs passing the bar (strict) | smoke scenario runs (all 4 steps) | step 2 options ≥1 | step 3 SeatMap | step 4 confirm | records per run (mean) | step-2 search ms median (min-max) | data arrived median (min-max) |
|---|---|---|---|---|---|---|---|---|
| vF a94ccbf | **10/10** | 10/10 (42/42 lines) | 10/10 | 10/10 | 10/10 | 3,2,3,2,3,3,2,1,2,2 (2.3) | 2886 (2104-3706) | 5.04 s (4.36-6.88) |
- vF seat steps: 10/10 SeatMaps with no `taken` list and an empty initial seat; 10/10 confirm Buttons named confirm_flight
  with a required check. Step 4 taps that Button while it is disabled (smoke notes "tapped a disabled Button (check:
  Pick a seat)") and still gets its summary 10/10.
- vF step 2: every data line succeeded on its first call (10/10 with 1 web search; the retry never fired); 1 prose line
  skipped in 2/10, 1 line repaired in 2/10; step 1 sent no data line in 10/10. Medians: step 1 first UI 1.46 s, screen
  4.19 s; step 2 first UI 1.67 s, screen 4.20 s; tap → seat map 1.60 / 3.51 s; confirm 1.82 / 2.98 s.
- vF fare labels: 21 of 23 cards carry a round-trip tag; no card shows one-way next to round trip; the Lufthansa card
  is round trip in 8 of 9 runs (run 9: [economy, Lufthansa]); date wording still appears in tags ("Depart Thu 26 Nov",
  "Nov. 26 fare") next to "round trip" in 5 runs; one price kept "round trip" unbracketed ("€460 round trip", run 7).
  Widgets flight line: a text answer this time (781 ms). HTML 1/1.
- **Dinner ×5 (a94ccbf, default judge): 5/5 scenario runs, 22/22 lines.** Places 1, 1, 3, 1, 2 (search 2350/2625/4539/
  2523/2627 ms, 1 web search each: Restaurant Feuerwache, RIVA, Restaurant Übersee, Bellissima Überseestadt, HAFENDÖNER
  Überseestadt); first UI 1.84 s, data 4.98 s (median). "We're six, and later." patched 5/5, judged by result: guests 2 → 6,
  time 20:00 → 21:00 (+60 min, same date), nothing else changed, 177 ms median (155-262), no LLM. Step 2 expect 4/5 (one
  run used a time DateTimeInput; informational). Widgets: RestaurantWidget with 5 places in 3.92 s. HTML 1/1.
- **Held-out ×1 (a94ccbf, default judge): 4/5.** Lisbon PASS (Arrival day, Days, Pace and "Plan my days"; no From/To
  trip-search form, no search), phones PASS, gift PASS (search 4016 ms, 5 records), haircut PASS; dog FAIL: 9 visible
  blocks (rule ≤ 7), the known cosmetic miss (same as d7a9e70).
- F4-F6 recaptured from vF run 1 (all 4 steps pass; step 2 3 cards all tagged round trip, no date claims; seat step
  with no taken or preselected seat; F6 summary "Lufthansa · BRE → NYC · 1 stop · from 605 €", no date).

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

## Production flight smoke after the flights merge (e65bae2, real clock ~03:57 Tue 24 Nov, 3 runs, --strict)
- **3/3 scenario runs pass; 14/14 lines** (a2ui steps 1–4 3/3 each; widgets 1/1, html 1/1). Report: session scratchpad prod-flight.md (not committed: talk numbers come from the evening smoke).
- Step 2 ("To New York, give me options."): first UI 2.46 s (1.44–2.80), screen done 5.06 s (4.81–5.27), data arrived 5.62 s (5.15–8.22), Worker search 2942 ms (2837–5155); options per run 4, 3, 2.
- Example cards (run 1): SWISS · BRE → JFK · 1 stop · from €429 · [economy, last-minute deal] (swiss.com); Lufthansa · BRE → JFK · 1 stop · from $494 · [round trip] (kayak.com). Fares are as the source page lists them; labels are the search model's reading.
- Dinner on production right after (real clock ~05:00, 2 runs, --strict): opener 2/2 with places 2 and 3 (search 2717/3508 ms); "We're six, and later." patched correctly 2/2 (Guests 2 → 6, time 19:00 → 20:00, 153/199 ms); one run failed only because the tap-place step drew 8 visible blocks (smoke limit 7; parked minor). Widgets dinner: RestaurantWidget with 5 places in 4.10 s.
- Places per dinner run before the flights change: 1–3 (talk clock, 615d559), 2/4/1 (production 787b35e); after: 1,1,3,1,2 (a94ccbf), 2,3 (production e65bae2). No clear thinning.
- Widgets flight with a destination on production ("Find me flights from Bremen to New York tomorrow."): FlightSearchWidget with 3 live flights (e.g. SWISS · BRE → JFK · 1 stop · from €429).

## Stage layout A browser checks (branch stage-shell, 2026-11-24 ~06:30)
Production build (`bun run build`) served statically from `dist/client` (no Worker: `/api/*` answers 404; Playwright stubbed `/api/soniox-key` so the dock shows its idle line). Headless Chromium has no microphone, so the dock shows "Microphone blocked…" in most shots; that is the real error path, not a layout fault. Screenshots: session scratchpad `shell-shots/` (not committed).
- F1–F3 in layout A: dinner places → table form → "We're six, and later." patch (guests 6, "s2 updated in place", decision model 2 values). The patched screen stays open; the opener folds to one line once F2 has finished (never mid-stream; the newest screen moved 6 px at the fold, 1600×900).
- New session → F4–F6 in a fresh session; the dinner session stays in the rail and one click brings its screens back. F1/F4 pressed on a session with turns open a fresh session by themselves.
- Reload with saved sessions: the most recent session opens with its screens; F1–F3 and the patch work again on top of it; Esc clears the open session; F4 after Esc plays into the cleared session.
- Clear conversation = Esc (wave). Esc inside the Delete-all dialog closes the dialog only (the thread stays). Delete all → one empty session, saved; the dialog counts only sessions with turns.
- Key box: with the stored key removed the stage shows the key box; `?k=` brings the stage back. `?classic` renders the previous layout on the same store and plays F1.
- 1920×1080, 1600×900, 1366×768: no horizontal scroll (scrollWidth = viewport width). At 1366×768 after F6 the "Confirm flight" button ends at y=506 and the dock starts at y=676. 14 sessions with long titles: the rail list scrolls, titles end in an ellipsis, the delete button shows on hover.
- Not checked here (needs a real mic and the Worker): live Space-to-talk in layout A, the "heard" tile state, the listening glow in the dark dock (the processing sweep was seen during replays).
