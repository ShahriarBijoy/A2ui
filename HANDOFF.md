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

## Status at hand-off
- **Step 1:** done locally (health 401/200, catalog served). Wrangler is logged into the owner's **personal** account; `account_id` is pinned. **Not deployed yet.** Deploy after the lanes land: `bun run deploy`, then `wrangler secret put` for DEMO_KEY, JEV_API_KEY, ANTHROPIC_API_KEY and SONIOX_API_KEY.
- **Five parallel lanes were dispatched** (disjoint file ownership, explicit-path commits):
  - **R** (steps 2–3): A2UI runtime, store, renderer, bricks, DevRunner, `turns.ts`.
  - **S** (step 4 + UX + widgets UI): App shell, panels, keyboard.
  - **W** (steps 5, 6, 11-server): Worker routes, turn loop, Claude composer, data, soniox-key.
  - **D** (steps 9–10 server): knobs, Jev client, router, predict, `scripts/jev-eval.ts`.
  - **V** (steps 8, 10 client): **DONE_WITH_CONCERNS**, commit 2b31dbc. The live mic test is pending (needs the SONIOX key and W's `/api/soniox-key`). It assumes temporary keys are reusable across presses (W issues them with `expires_in_seconds: 600`, not single-use, which is consistent). It added `useMountEffect.ts`.
- If a lane has no report file and no commits, its agent died with the old session. Re-dispatch it with `common.md` + its brief (model opus; sonnet for V), then check `git status` for its half-written files first.

## Next steps after the lanes
1. Review each lane against its brief (spec compliance + quality) and fix gaps.
2. Integrate: App wiring check, `?dev` DevRunner, `useVoice` mounted, widgets.
3. Run the step checks in order: 2, 3, 4, 5, 6, then step 7 (tune the composer prompt until dinner and flight pass 5/5, logging in NOTES), 8, 9, 10, 11.
4. Step 12: replay (Shift+R saves the last turn to localStorage; F1..F6 play `replay.ts` with the original timing and a "replay" badge), 1920×1080 and 1280×720 layouts, error handling.
5. Step 13: `scripts/smoke.ts` over `src/shared/scenarios.ts` against the deployed URL; save the numbers to NOTES.md.
6. Deploy; give the owner the URL with `?k=<DEMO_KEY>` (the value is in `.dev.vars`).

## Waiting on the owner
- `ANTHROPIC_API_KEY` and `SONIOX_API_KEY` in `.dev.vars` (empty at hand-off). The Soniox key needs the "Temporary API keys" permission.
- Venue name and city (`VENUE_NAME` / `VENUE_CITY` vars in wrangler.jsonc; currently "TODO venue", "Bremen").
- 8 real places near the venue for `src/worker/data/places.json` (placeholders are marked "(TODO)").
- Talk date (it decides whether to apply PLAN's cut order) and the projector resolution.
- Talk wording: upstream A2UI now calls v1.0 **stable**, so PLAN §9.3's "v1.0 candidate" line should change.

## Owner preferences
- shadcn on **Base UI**, with the full component set installed. The catalog the agent sees stays at PLAN's 17 bricks (explained to the owner; ask before adding bricks).
- Use subagents for parallel work and Fable as the advisor; treat it as our own project; be creative within the spec.
- **No commit attribution trailers.**
- Use the personal Cloudflare account only.
