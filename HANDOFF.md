# HANDOFF — resume Brick Box in a new session

Written 2026-11-23 when the owner moved from a Code Mode session to a normal one. Keep this file current; delete it when the build is done.

## Resume here (paused 2026-11-24 ~05:40 at the owner's request)
- **Production is unchanged and stable:** e65bae2 (live web flights, key box, rate limits). Nothing below is deployed.
- **Redesign approved** (spec `docs/superpowers/specs/2026-11-24-stage-redesign-design.md`, plans in `docs/superpowers/plans/`). Two branches, both pushed to GitHub as backup:
  - `stage-shell` (worktree `C:/Users/Shahr/AppData/Local/Temp/claude/4400adc4556695d6/dfd733ae-9a40-47f7-b403-5c3fd6ee7705/scratchpad/bb-shell`): layout A, sessions, Clear, drawn brick tiles, folded turns, `?classic` fallback. Done: 7 commits, 514 tests, browser-checked at 1920×1080 / 1600×900 / 1366×768 (screenshots `C:/Users/Shahr/AppData/Local/Temp/claude/4400adc4556695d6/dfd733ae-9a40-47f7-b403-5c3fd6ee7705/scratchpad/shell-shots/`). Report: `.superpowers/sdd/stage-shell-report.md`. Needs the owner's mic check.
  - `brick-catalog` (worktree `C:/Users/Shahr/AppData/Local/Temp/claude/4400adc4556695d6/dfd733ae-9a40-47f7-b403-5c3fd6ee7705/scratchpad/bb-bricks`): the 10 new bricks + icon props, og:image enrichment. Done: 529 tests; talk-clock eval at 6943acb flight 10/10 strict, dinner 9/10, held-out 8/8. Report: `.superpowers/sdd/brick-catalog-report.md`. **Follow-up in progress** (WIP commit on the branch): a prompt line so Alerts/Badges never state unstated facts + a smoke check; **re-run flight 10 and dinner 10 at the talk clock, then finalise the commit.**
- **Next steps:** (1) finish the brick-catalog follow-up eval; (2) merge both into master (expect conflicts in `Surface.tsx`, `index.css`, `HANDOFF.md`, `NOTES.md`); full `bun test` + `bunx tsc -b`; (3) deploy from a clean worktree; production smoke (flight 3, dinner 2) + browser checks (F1–F6, New session, Clear, key box); (4) owner rehearsal with the mic. **Go/no-go Wed 25 Nov 12:00**; if missed, production stays e65bae2.
- The worktrees live in the session scratchpad; if it was cleared, recreate them from the pushed branches.

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

## Blocker resolved (2026-11-24 ~01:20)
The owner raised the Anthropic spend limit. The key answers again (Haiku 1.3 s, Sonnet 1.9 s). On production 787b35e both main scenarios pass 6/6 with the result-judging smoke; see NOTES → "Production main scenarios after the spend-limit raise". **Watch spend:** avoid large smoke runs; one full smoke is roughly 60–80 turns.

## Status at hand-off (updated 2026-11-24 ~05:00)
- **Production:** https://brick-box.shahriarbijoy.workers.dev runs **e65bae2** (deployed 2026-11-24 ~03:56): composer `claude-sonnet-5-5` (search, widgets and html on Haiku), live web search for places, events **and flights** (no demo data left), the decision model, replay with shipped F1–F6 (F4–F6 recaptured with live flights at a94ccbf), voice-glow, the Esc wave, live widgets, readable API errors, **per-IP rate limits** (7e120ba) and the **demo key box** (48c647a: enter the key once per browser; no `?k=` needed).
- **GitHub:** https://github.com/ShahriarBijoy/A2ui (private), master pushed.
- **Everything merged is reviewed** (the key box was verified in a browser instead). 473 tests pass, and `bunx tsc -b` is clean. Ledger: `.superpowers/sdd/progress.md`.
- **Talk clock (in-process, a94ccbf):** flight 10/10 including seat map and confirm, dinner 5/5, "We're six, and later" patch 5/5. **Production (real clock, e65bae2):** flight 3/3; dinner 1/2 at ~05:00 (the miss: the tap-place step drew 8 blocks against the smoke's limit of 7; places 2 and 3, patch correct both runs).
- **Browser checks on production:** F4–F6 replays play (form → 3 live flight cards → empty seat map, Confirm disabled until a seat is picked, no /api calls); a wrong stored key is cleared on the first 401 and the key box returns.
- **Remaining (owner-dependent):** (the API key works again)
  1. The owner's live mic rehearsal in Chrome (checklist below). Save good turns with Shift+R, export with Shift+E, and paste them into `src/client/replays.json` (shipped F-key replays), then redeploy.
  2. ~~Confirm the venue and date~~ **Confirmed by the owner 2026-11-24:** JAAI, Konsul-Smidt-Straße 8p, Wed 25 Nov 18:00.
  3. **Flights: owner chose web search (2026-11-24); merged.** Talk-clock flight chains: 10/10 at a94ccbf (final), 10/10 at d7a9e70, 8/10 at f35faaa; dinner 5/5 at a94ccbf. See NOTES "Flights from live web search". Deployed e65bae2 (2026-11-24 ~03:56): production flight smoke 3/3 strict (NOTES "Production flight smoke after the flights merge").
  4. Re-run `bun run smoke` against production during the evening before the talk (18:30–19:30) and commit `scripts/smoke-results.md`. Those are the numbers for the talk.
- **Parked minors** are in the ledger. The notable ones: block count can reach 8; the patch caption shows a raw ISO value for merged date+time patches; PLAN §9.3 should say "A2UI v1.0" (upstream marks it stable).
- **Talk content notes:** the §9.1 beats now depend on what the composer builds, since there are no scripted flows; replay is the safety net. The closing line's N/M comes from the session totals, which replays don't change. Don't quote vendor numbers (§9.3).

## Event (found by web search 2026-11-23; **confirmed by the owner 2026-11-24**)
- Next AI Tinkerers Bremen meetup: **Wednesday 2026-11-25, 18:00 CET** (18:30 demos, 20:00 networking + food). https://bremen.aitinkerers.org/p/ai-tinkerers-bremen-4
- Venue: **Just Add AI (JAAI)**, Konsul-Smidt-Straße 8p, 28217 Bremen (Überseestadt / Europahafen). Confirmed by the owner.
- **If this is the talk, the deadline is 2 days: apply PLAN's cut order up front.** Priorities: deploy → replay (never cut) → rehearsal → smoke numbers.
- **Owner direction (2026-11-23): no fixed data and no scripted flows.** Anyone can ask anything; the UI renders on the fly with skeletons while live data loads. `places.json` is NOT used for the product; places come from live web search (see `.superpowers/sdd/phase2-W-live-search-brief.md`). The research in `places-research.md` is only background.
- The owner likes **voice-glow** (VoiceBeam) and **distortion-waves** (DistortionWave) from libraries.dev; see `phase2-S-components-brief.md`.

## Waiting on the owner
- (Keys: ANTHROPIC_API_KEY and SONIOX_API_KEY were added to `.dev.vars` and verified live on 2026-11-23: Claude answered, Soniox temp key minted 201.)
- Projector resolution (assume 1920×1080).
- Talk wording: upstream A2UI now calls v1.0 **stable**, so PLAN §9.3's "v1.0 candidate" line should change.

## Open decisions
- **UI SDK (vercel-labs/ui, ui-sdk.dev):** the owner suggested it to "not need prebuilt components". Investigated 2026-11-23. It is build-time behaviors for coding agents plus a runtime agent bridge that *operates* existing components. It has no runtime JSON renderer. Letting the runtime agent "build anything" would mean the LLM writes code, which collapses the talk's A2UI-vs-HTML contrast. **Ruling: keep the A2UI catalog with shadcn/Base UI bricks; don't install it mid-build.** The owner was asked "should the runtime agent compose (data) or write (code)?". If they choose code, that changes the thesis: revisit PLAN §0.1 / §9 with them before touching code. A later swap of the primitives would touch only `a2ui/bricks/*` and `components/ui`.
- **Router latency from a Worker:** NOTES says the 800 ms budget holds, but that was measured from Bun with keep-alive. After deploy, measure `route.ms` from the deployed Worker, both cold and warm. If cold misses 800 ms, warm the Jev connection on page load or Space-down (the predict call already warms it). Do NOT silently raise the timeout.

## Rate limits (7e120ba)
- Per client IP, after the key check: `/api/turn` 40 per minute, other `/api/*` 300 per minute (Workers Rate Limiting binding, approximate, per Cloudflare location). Over the cap: 429 and "Too many requests: wait a minute, then try again."
- Free plan: 100,000 Worker requests/day (reset 00:00 UTC = 01:00 Bremen; Error 1027 after). Static assets are free and unlimited, so only `/api/*` and `/catalog/*` count. No charge on the Free plan; over the limit the API pauses until the reset. A limiter cannot keep that count down (a refused request already ran the Worker); it protects the Claude/Soniox spend.

## Stage replay map (shipped, works offline; real Sonnet captures at the talk clock)
| Key | Turn |
|---|---|
| F1 | "I want dinner after this event, pick a place nearby." (3 real places) |
| F2 | tap a place → time + guests + Reserve |
| F3 | "We're six, and later." → decision-model patch, compose – |
| **Esc** | **required between F3 and F4** (both sequences start at surface s1) |
| F4 | "I need to book a flight tomorrow." ("Flight tomorrow": From Bremen, To empty, Date Thu 26 Nov, "Search flights") |
| F5 | "To New York, give me options." (3 web results, fares as listed and each tagged round trip: Lufthansa from 605 €, Air France 460 €, KLM from EUR590) |
| F6 | tap Lufthansa → generic seat map (no taken seats, none preselected) + Confirm flight |
- Tapping the live buttons after F3 ("Reserve table") or F6 ("Confirm flight") sends a real turn (spends API budget; fails if offline).
- The recordings' dates are fixed for Wed 25 Nov ("tonight", flight on Thu 26 Nov).
- All six F-keys are taken by the shipped set, so Shift+R saves get no key. Swap `src/client/replays.json` if rehearsal produces better turns (Shift+E exports).

## Verification done 2026-11-24 (before the spend limit hit)
- Voice E2E on production with a synthetic mic: interim words ~200 ms apart; turn out 0.34–0.38 s after Space-up; screen built (Final D).
- Wrong-key check: one calm error line + Try again (Final E).
- The smoke now judges the "We're six, and later" patch by its result: 7/7 live patches correct (guests 6, time +60 min same date, nothing else). It catches the old false passes.

## Rehearsal checklist (owner, on the stage machine, Chrome)
- Open the deployed URL (no `?k=` needed). A key box asks for the demo key once (`DEMO_KEY` in `.dev.vars`); the browser remembers it (localStorage), so the projector never shows it. Do this before the talk on the stage machine. A wrong key says "That key is not right."; a key that stops working brings the box back. Allow the mic.
- Hold Space: the transcript appears grey, then final; the glow rises; release, and the turn goes out.
- Press real F1, F3, F5 and F6: they must play replays, not reload, open help or find, or jump to the address bar. Slots 5–6 may leak in Chrome; if so, use F1–F4 on stage.
- Shift+R after each good live turn to save it; Shift+E (or DevRunner "Copy replays JSON") to export, so the controller can ship them in `src/client/replays.json`.
- Turn wifi off and replay: it must still work.
- Esc: the wave carries the thread away.

## Owner preferences
- shadcn on **Base UI**, with the full component set installed. The catalog the agent sees stays at PLAN's 17 bricks (explained to the owner; ask before adding bricks).
- Use subagents for parallel work and Fable as the advisor; treat it as our own project; be creative within the spec.
- **No commit attribution trailers.**
- Use the personal Cloudflare account only.
