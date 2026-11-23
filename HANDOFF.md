# HANDOFF — resume Brick Box in a new session

Written 2026-11-23 when the owner moved from a Code Mode session to a normal one. Keep this file current; delete it when the build is done.

## Read in this order
1. `PLAN.md`: the spec (authoritative). Build steps in §8, each with an acceptance check.
2. `NOTES.md`: verified API facts, measurements and rulings. These override PLAN where they differ (for example: Soniox SDK = `@soniox/client`, `stt-rt-v6`; Jev knobs never list the current value; TS 7 has no `baseUrl`).
3. `CLAUDE.md`: commands, layout and rules.
4. `.superpowers/sdd/progress.md`: the ledger (gitignored). Lane briefs `lane-{R,S,W,D,V}-brief.md` and reports `lane-*-report.md` sit next to it. `common.md` holds the constraints every lane follows.

## Architecture in one breath
Vite + React 19 + Tailwind 4 + shadcn (**Base UI**, all components installed) client; Hono Worker on the Cloudflare Vite plugin.
`/api/turn` streams SSE `TurnEvent`s: route (Jev), a2ui (llm/data/knob), caption, usage, done.
Every event enters the client through `store.applyTurnEvent`, the single ingress that replay also uses.
Contract files: `src/shared/{a2ui,catalog,protocol,pointer}.ts` and `src/client/state.ts`.

## Status at hand-off (updated 2026-11-23 ~20:35)
- **All five lanes have landed.** Whole tree: `bunx tsc -b` clean, `bun test` 224 pass / 0 fail.
- **Deployed:** https://brick-box.shahriarbijoy.workers.dev (open with `?k=<DEMO_KEY from .dev.vars>`). Latest deploy: fb43969, with live web search, voice-glow, the Esc wave and live widgets. Redeploy with `bun run deploy` from a green tree.
- **All lanes and phases 2–3 are complete and reviewed** (ledger: `.superpowers/sdd/progress.md`). 352 tests pass.
- **V (voice, steps 8/10 client):** complete and reviewed (2b31dbc..b60b31e). The live mic test with the owner is pending.
- **D (decision model, steps 9/10):** complete and reviewed (5461a57..22a1cf6). 30/30 live lines, warm route ~150 ms. `warmJev` exists but is **not wired yet**.
- **R (A2UI runtime/renderer, steps 2–3):** landed (b8bfe71..e2b8165, 55 tests); **review was running** at hand-off. See `.superpowers/sdd/lane-R-review.md` if present; if not, re-dispatch the review.
- **W (Worker/composer, steps 5/6/11):** landed (4becab3..bcacf04, 74 tests). Live: first UI 0.6–0.9 s, dinner 2/2, flight 4/4, 0 refused over 54 turns. **Review was running**; see `lane-W-review.md`.
- **S (stage shell, step 4 + UX):** landed (99349f0..0e83338, 27 tests). Headless checks pass at 1920 and 1280. **Review was running**; see `lane-S-review.md`.
- Measured numbers are in NOTES.md → Measurements.

## Fix rounds in flight at hand-off (check reports and git log)
- R round 1: clearThread resets `replaying`; SSE client tests; **pending-list skeletons only while the owning turn streams**, then empty state or nothing.
- W round 1 (step A): one caption per turn; check stop_reason on every call; count repaired lines; scenario steering removed; held-out lines re-run.
- S round 1: the wire row stays in place on expand; `isTypingTarget` predicate so Slider and read-only focus doesn't kill Space and shortcuts. U8/U2 deviations accepted by ruling.
- After those pass their scoped re-reviews: land the contract additions (fetch event, search source, `repaired_lines`), then dispatch phase 2 (W live search, S components), then deploy.

## Integration TODO (after the reviews and their fix rounds)
1. ~~Wire /api/warm~~: not needed. The cold route from the deployed Worker was 153 ms (NOTES → Production).
2. Voice: add a minimum-length guard so one-word fragments like "I'" are not sent as turns (seen in lane S's live session).
3. `index.css`: add a darker highlight token for highlight-coloured *text* (lane S measured 3.1:1 on the background).
4. Step 12: replay (Shift+R saves the last turn's `recordings[turnId]` to localStorage; `src/client/replay.ts` holds exported turns; F1..F6 play them through `store.beginTurn` + `applyTurnEvent` with the original timing and a "replay" badge). Also: check error handling with a wrong ANTHROPIC key (one error line + Try again), and check the stage layout.
5. Step 13: `scripts/smoke.ts` over `src/shared/scenarios.ts` against the deployed URL, all three modes, 3× each; write the numbers into NOTES.md.
6. Deploy: `bun run deploy`, then `wrangler secret put` DEMO_KEY / JEV_API_KEY / ANTHROPIC_API_KEY / SONIOX_API_KEY. Then measure `route.ms` from the deployed Worker, cold and warm.
7. A live voice rehearsal with the owner in Chrome (both scenarios by voice, U1/U2).

## Next steps after the lanes
1. Review each lane against its brief (spec compliance + quality) and fix gaps.
2. Integrate: App wiring check, `?dev` DevRunner, `useVoice` mounted, widgets.
3. Run the step checks in order: 2, 3, 4, 5, 6, then step 7 (tune the composer prompt until dinner and flight pass 5/5, logging in NOTES), 8, 9, 10, 11.
4. Step 12: replay (Shift+R saves the last turn to localStorage; F1..F6 play `replay.ts` with the original timing and a "replay" badge), 1920×1080 and 1280×720 layouts, error handling.
5. Step 13: `scripts/smoke.ts` over `src/shared/scenarios.ts` against the deployed URL; save the numbers to NOTES.md.
6. Deploy; give the owner the URL with `?k=<DEMO_KEY>` (the value is in `.dev.vars`).

## Event (found by web search 2026-11-23; owner to confirm)
- Next AI Tinkerers Bremen meetup: **Wednesday 2026-11-25, 18:00 CET** (18:30 demos, 20:00 networking + food). https://bremen.aitinkerers.org/p/ai-tinkerers-bremen-4
- Location says "exact location details will be provided later". The venue sponsor logo is **Just Add AI (JAAI)**, HQ Konsul-Smidt-Straße 8p, 28217 Bremen (Überseestadt / Europahafen). This is an inference.
- **If this is the talk, the deadline is 2 days: apply PLAN's cut order up front.** Priorities: deploy → replay (never cut) → rehearsal → smoke numbers.
- **Owner direction (2026-11-23): no fixed data and no scripted flows.** Anyone can ask anything; the UI renders on the fly with skeletons while live data loads. `places.json` is NOT used for the product; places come from live web search (see `.superpowers/sdd/phase2-W-live-search-brief.md`). The research in `places-research.md` is only background.
- The owner likes **voice-glow** (VoiceBeam) and **distortion-waves** (DistortionWave) from libraries.dev; see `phase2-S-components-brief.md`.

## Waiting on the owner
- (Keys: ANTHROPIC_API_KEY and SONIOX_API_KEY were added to `.dev.vars` and verified live on 2026-11-23: Claude answered, Soniox temp key minted 201.)
- Confirm the venue (inferred JAAI, Überseestadt) and that the talk is the 25 Nov meetup.
- Projector resolution (assume 1920×1080).
- Talk wording: upstream A2UI now calls v1.0 **stable**, so PLAN §9.3's "v1.0 candidate" line should change.

## Open decisions
- **UI SDK (vercel-labs/ui, ui-sdk.dev):** the owner suggested it to "not need prebuilt components". Investigated 2026-11-23. It is build-time behaviors for coding agents plus a runtime agent bridge that *operates* existing components. It has no runtime JSON renderer. Letting the runtime agent "build anything" would mean the LLM writes code, which collapses the talk's A2UI-vs-HTML contrast. **Ruling: keep the A2UI catalog with shadcn/Base UI bricks; don't install it mid-build.** The owner was asked "should the runtime agent compose (data) or write (code)?". If they choose code, that changes the thesis: revisit PLAN §0.1 / §9 with them before touching code. A later swap of the primitives would touch only `a2ui/bricks/*` and `components/ui`.
- **Router latency from a Worker:** NOTES says the 800 ms budget holds, but that was measured from Bun with keep-alive. After deploy, measure `route.ms` from the deployed Worker, both cold and warm. If cold misses 800 ms, warm the Jev connection on page load or Space-down (the predict call already warms it). Do NOT silently raise the timeout.

## Owner preferences
- shadcn on **Base UI**, with the full component set installed. The catalog the agent sees stays at PLAN's 17 bricks (explained to the owner; ask before adding bricks).
- Use subagents for parallel work and Fable as the advisor; treat it as our own project; be creative within the spec.
- **No commit attribution trailers.**
- Use the personal Cloudflare account only.
