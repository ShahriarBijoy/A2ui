# Stage redesign: layout A, sessions, clear, 27 bricks

Date: 2026-11-24. Owner decisions in this doc are marked **(owner)**; the rest are the controller's calls, marked **(call)**.
Talk: AI Tinkerers Bremen, Wed 25 Nov 2026, 18:00, JAAI. Projector assumed 1920×1080.

## Why
The owner finds the current interface scattered ("the whole layout looks all over the place") and wants it beautiful and professional, with icons, a visible way to clear the conversation, sessions, and a richer component pool. The talk's claim is generative UI from a fixed catalog of bricks; a polished stage screen and a bigger catalog make that claim land.

## Goals
1. **Layout A "Stage"** (owner): the light layout from the review artifact (https://claude.ai/artifact/QxXiKSnb3TmuYbeTRsXocT, section "A · Stage").
   - Left rail (~248 px): brand mark + name, "New session" button, sessions list, footer with "Answer with" mode switch (Widgets 1 / HTML 2 / A2UI 3), Decision model toggle, Hands-free toggle.
   - Main column: top bar (session title with its icon, a mono line naming mode and composer model, buttons "Replays" and "Clear conversation"); the conversation stream with the newest turn expanded and every earlier turn folded to one line (what was said + what was built + time), click to expand **(call)**; a floating voice dock at the bottom centre (mic button with the existing voice-glow, status line "Hold Space to talk" / live transcript, a typed-request field).
   - Right panel "Under the hood" (~360 px): tabs **Bricks** (the pool, default), **Wire**, **Data**; footer metrics Turns / LLM calls avoided / Tokens (moved from the bottom bar).
2. **Icons everywhere in the app chrome** (owner): lucide-react (already a dependency). Professional finish: consistent sizes, stroke width, spacing, focus states.
3. **Clear conversation button** (owner): same effect as Esc today (distortion-wave clear of the current session's thread, surfaces, wire and pool state), in the top bar.
4. **Sessions** (owner): "New session" starts an empty session; earlier sessions stay in the list and reopen with one click with their conversation and screens. Saved in this browser (localStorage) **(call)**; delete from the list (with an in-page confirm) **(call)**. Title = the session's first utterance, shortened **(call)**; icon = the first Icon brick that session's screens used, else a generic chat icon **(call)**.
5. **27 bricks** (owner: all ten new): Icon, Table, Chart, Timeline, Image, Badge, Alert, Accordion, Progress, Rating, added to the agent's catalog and rendered by the client. OptionCard and Button gain an optional `icon` prop **(call)** (the mock shows plane icons on flight cards).
6. **Brick pool visual** (owner liked A's pool): a 3-column grid of tiles, each with a small drawn glyph of the brick and its name; states used (filled accent), heard (accent outline), idle; groups Layout / Content / Input / Custom / plus the new ones placed in their natural groups **(call)**; legend.

## Non-goals
- Dark mode, phone layout, accounts or cloud sync of sessions.
- Changing how turns, routing, the decision model, voice, search or replays work, beyond what new bricks need.
- New worker endpoints.

## Anti-goals (a failure even if it works)
- Anything that breaks the talk path: Space-to-talk, F1–F6 replays, Esc, the ~0.2 s "We're six, and later." patch, the key box.
- A brick that shows a fact nobody stated: Image URLs, ratings and table cells that hold real-world facts must come from a data line (live search), never written by the composer. Unknown → nothing shown.
- Layout shift while a screen streams in; text clipped by fixed widths; icons of mixed sizes.

## Constraints
- Stack stays: Vite, React 19, Tailwind 4, shadcn on Base UI, lucide-react, Geist / Geist Mono, tokens in `src/client/index.css` (light palette; refine, don't replace). Respect `prefers-reduced-motion`.
- Every turn event still enters through `store.applyTurnEvent` (replay depends on it). Contract files (`src/shared/{a2ui,catalog,protocol,pointer}.ts`, `src/client/state.ts`) change only as this doc says.
- A2UI v1.0 message shapes unchanged; new bricks are catalog components under the existing catalogId.
- Must fit 1920×1080 and stay usable at 1600×900 and 1366×768 (rail and panel narrow below 1440 px wide) **(call)**.
- Work on a branch; production keeps the current build until the checks below pass. **Go/no-go: Wed 25 Nov 12:00.** If it misses, production stays as is.
- **Reversible on stage** **(call)**: the current layout stays reachable with `?classic` until after the talk, sharing the same store, so a broken new layout costs one URL change.
- No new runtime dependencies unless a brick truly needs one (recharts is already installed; plain CSS/SVG bars are fine).

## Approaches considered
- **Layout:** A "Stage" (light, sessions rail, screen centre, one under-the-hood panel) vs B "Studio" (dark, periodic-table pool, wire + timing chart) vs C "Split" (conversation | screen). **Owner picked A** ("more detailed and nice layout").
- **Build:** (1) restyle the existing panels in place; (2) a new app shell and panels beside the old ones, old layout behind `?classic`. **Call: (2)**. It costs a little duplication for two days and keeps a one-URL fallback for the talk.
- **Bricks:** six now / all ten. **Owner: all ten.**

## New bricks (props as the agent sees them)
| Brick | Group | Props | Notes |
|---|---|---|---|
| Icon | Content | name (one of a fixed list), size? ("sm","md","lg") | Fixed list of ~40 lucide names (travel, food, time, money, places, status). Unknown name → refused like an unknown component. |
| Table | Layout | columns ([{label, field}]), rows (path to a list, or literal array of objects) | Cells read `field` of each row; null → empty cell. |
| Chart | Content | type ("bar"), items (path or literal [{label, value}]), unit? | Bars drawn to one scale with value labels. |
| Timeline | Content | items (path or literal [{title, time?, detail?}]) | Vertical. |
| Image | Content | url (bound to data), alt, aspect? ("wide","square") | url must be http(s) and come from a data line; skeleton while loading; on error the image hides. Search gains an `image` field hint (photo URL from a result page, else null). |
| Badge | Content | text, variant? ("neutral","success","warning","danger") | |
| Alert | Content | title?, text, variant? ("info","warning","success") | |
| Accordion | Layout | items ([{title, child}]) where child is a component id | A container: children reachable via items. |
| Progress | Content | value, max? (default 100), label? | |
| Rating | Content | value (number, or a string like "4.5/5" from data), max? (default 5) | Shown only when a value exists. |
| OptionCard, Button | — | + icon? (same fixed list) | |

The composer prompt lists the new bricks through `catalogPromptBlock()` and gains short rules: Image/Rating values only from data fields; Table/Chart/Timeline for comparisons, numbers and schedules; at most 7 visible blocks still holds. Jev predict hints come from `predictHint` as today.

## Checks before go (all on the branch)
1. `bun test` and `bunx tsc -b` clean; unit tests for each new brick's validation and rendering rules, sessions save/restore/delete, clear.
2. Talk-clock eval (in-process server, DEV_NOW 2026-11-25T18:45): flight 10 runs, dinner 10 runs, held-out 1 run each; bars as before (flight ≥ 9/10 strict, dinner ≥ 9/10 with real places and the patch judged by result). Results recorded in NOTES with the commit.
3. Browser checks on the deployed preview: F1–F6 replays play; Esc and Clear work; New session → old session reopens with its screens; the key box; voice dock states; 1920×1080 and 1366×768 screenshots.
4. Independent review of the branch before merge.

## Stage flow (owner)
- Between dinner and flight the presenter clicks **New session**; dinner stays in the rail (this also shows sessions working).
- **F1 and F4 start a fresh session themselves** when the open session is not empty, so the "Esc between F3 and F4" rule goes away. Replayed turns are saved into the session like live ones **(call)**; totals still exclude them.
- **Delete all sessions** (rail menu, in-page confirm) clears rehearsal sessions before the talk, so no rehearsal titles reach the projector. The page opens on the most recent session, or a fresh empty one when there are none **(call)**.
- Esc keeps clearing the open session (same as Clear conversation).
- The HANDOFF rehearsal checklist and stage replay map are updated to this flow.

## Builder-check answers (controller calls)
- **Two tracks, merged independently** **(call)**: Track 1 = shell (layout A, icons, Clear, sessions, pool visual): client-only, gated by tests + browser checks. Track 2 = catalog (10 bricks, `icon` prop, prompt and search changes): gated by the talk-clock eval; start it first because its eval is slowest. Either can ship at 12:00 without the other.
- **Cut order if time runs short** **(call)**: Track 2: Image, then Rating, then Accordion, then Progress (owner wanted all ten; cuts only to save the deadline, and the owner is told). Track 1: folding of older turns, then the Replays button, then session icons.
- **Totals stay per page visit** **(call)**: Turns / LLM calls avoided / Tokens count the whole visit as today (replays excluded, not persisted across reload), so the closing line "N of M turns" covers both scenarios even across sessions. Each session row shows its own turn count from its thread.
- **Image URLs** **(call)**: when a search requests an `image` field, the Worker fetches each record's `source` page (parallel, ~1.5 s cap, small read limit) and takes its `og:image`/`twitter:image` meta; the model is never asked to write image URLs. Records arrive without waiting for images; images follow as a second data update for the same path. No image found → null → Image brick shows nothing.
- **"Only from data" is a prompt rule plus eval checks** **(call)**, not processor enforcement (no per-path origin in state.ts). The smoke judge gains a check: every Image url / Rating value on screen equals a value delivered by a data event in that session. Copying a tapped item's fields as literals stays allowed (they came from data).
- **Patched screen stays expanded** even if its turn is older (the "We're six, and later." edit must stay visible).
- **Tables are read-only comparisons**; tappable options stay OptionCards (the prompt says so).

## Left to the builder
Component structure and file names; exact spacing scale; the glyph drawings; the icon list's exact names (from lucide-react's exports); how session snapshots are serialised and capped (keep them small: drop recordings and very old wire entries); keyboard focus order; animation details within the existing voice-glow / distortion-wave pieces.
