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

## Status at hand-off (updated 2026-11-23 ~23:05)
- **Production:** https://brick-box.shahriarbijoy.workers.dev runs **fb43969** (live search, voice-glow, Esc wave, live widgets). It **lacks**: replay (step 12), the replay-totals fix, lenient @checks, the composer structure fixes (d78f02e) and the decision-model time/guard fixes (5f2eff0+). **Redeploy** once the open reviews and fix rounds below clear (`bun run deploy` from a green tree), then re-run `bun run smoke` against production and refresh `scripts/smoke-results.md` and NOTES.
- **Complete and reviewed:** lanes R, S, W, D, V; phases 2 (R, S, W) and 3 (widgets live); step 12 replay (4f7da0e, b020f5e, 5b580c1); lenient @checks (c22534f). Ledger: `.superpowers/sdd/progress.md`.
- **Open at hand-off:**
  - Decision model fix round 1 (relativeHint edge wording; never a backwards patch).
  - Review of the composer structure fixes d78f02e.
  - Voice fragment guard (dispatched to the voice agent).
- **Smoke:**
  - Production (old fb43969): 53/62.
  - Local HEAD (d78f02e, 22:56 Monday): 59/62. Main 3/6, wildcards 9/9, held-out 15/15, pink 3/3.
  - Main misses: dinner "later" partial (possibly stale; it ran before 5f2eff0) and flight seat step (9 blocks; once no confirm target, which may be the script's matcher). **Re-run the main scenarios 10× on HEAD after the D fix round lands.** Only if a composer gap remains, A/B Sonnet 5.5 with a composer-only model var and per-model thinking config (Sonnet 5.5 rejects `thinking: disabled`; use `between_tools`).
- **Next fixes queued:**
  - Retry double search (reuse the search on the same `into` path).
  - Search scope (only local, current or changing facts; the quiz shouldn't fetch vocabulary).
  - Dev-only clock override in `.dev.vars` for testing at the talk's time.
  - Smoke dumps of the surface, knobs and Jev probabilities for steps that should patch and don't.
  - The step-12 wrong-API-key check (one error line + Try again).
- **The §9.1 talk beats now depend on what the composer builds (no scripted flows). Replay is the safety net:** save good turns with Shift+R during rehearsal.

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

## Rehearsal checklist (owner, on the stage machine, Chrome)
- Open the deployed URL with `?k=<DEMO_KEY>`. Allow the mic.
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
