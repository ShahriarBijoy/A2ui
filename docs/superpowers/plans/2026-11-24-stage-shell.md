# Stage Shell (layout A, sessions, clear) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the stage screen with layout A ("Stage"): sessions rail, centred screen with folded earlier turns and a floating voice dock, and an "Under the hood" panel; add Clear conversation and sessions; keep the old layout behind `?classic`.

**Architecture:** Client only. Sessions live in the existing store (`src/client/store.ts`) as saved snapshots of the per-session state, persisted to localStorage by a small `sessions.ts` module. A new `src/client/stage/` folder holds the layout A components; `main.tsx` picks StageApp or the old App. Turn events still enter only through `store.applyTurnEvent`.

**Tech Stack:** React 19, TypeScript 7 strict, Tailwind 4, shadcn on Base UI, lucide-react, bun test.

**Spec:** `docs/superpowers/specs/2026-11-24-stage-redesign-design.md` (Track 1 of its "Two tracks"). Visual reference: https://claude.ai/artifact/QxXiKSnb3TmuYbeTRsXocT section "A · Stage" (HTML source: the session scratchpad file brick-box-redesign.html).

## Global Constraints
- Every turn event still enters through `store.applyTurnEvent` (replay depends on it).
- Contract file `src/client/state.ts` changes only by the session additions in Task 1.
- Light palette: refine the tokens in `src/client/index.css`, don't replace them. Geist / Geist Mono. Icons from lucide-react only; app chrome icons 16 px (controls) / 18 px (headers), stroke 1.75.
- Must fit 1920×1080 and stay usable at 1600×900 and 1366×768: rail 248 px and panel 360 px, narrowing to 220 px / 320 px below 1440 px wide. No horizontal page scroll.
- The old layout stays reachable with `?classic` (same store).
- Totals (Turns / LLM calls avoided / Tokens) count the page visit as today: not per session, not saved, replays excluded.
- Sessions saved in this browser only (localStorage), at most 20 (oldest dropped); delete-all uses an in-page confirm (no window.confirm).
- F1 and F4 (any recording that starts a sequence) start a fresh session when the open one is not empty; Esc and "Clear conversation" clear the open session.
- Respect `prefers-reduced-motion`. No new runtime dependencies.
- Do not run `bun run dev` or `wrangler dev` (low memory). Browser checks use a production build served statically.
- Commits: conventional, explicit paths (`git commit -m "…" -- <paths>`), no attribution trailers.

## Review Focus
1. Creating or switching a session while a turn streams or a replay plays: the turn and replay stop; none of their events land in the new session. (Task 1 test "events for a turn of another session are ignored"; Task 3 wiring.)
2. localStorage blocked, full or holding a corrupt value: the app still runs, sessions just are not saved; a corrupt entry is skipped. (Task 1 tests.)
3. Reload while a turn was pending: the restored session shows that turn as stopped, never an endless skeleton. (Task 1 test.)
4. Long titles and many sessions: titles truncate with an ellipsis, the list scrolls, the 21st session drops the oldest. (Task 1 cap test; Task 3 CSS.)
5. 1366×768: no horizontal scroll, and the floating dock never covers the newest screen's primary button. (Task 6 browser check.)

---

### Task 1: Sessions in the store, saved in the browser

**Files:**
- Create: `src/client/sessions.ts`, `src/client/sessions.test.ts`
- Modify: `src/client/state.ts` (types + StoreApi), `src/client/store.ts`, `src/client/store.test.ts`

**Interfaces:**
- Consumes: `IconName` from `@shared/icons`; existing `ThreadItem`, `SurfaceState`, `WireEntry`, `PoolState`, `AppState`.
- Produces:
  - `state.ts`: `export type SessionMeta = { id: string; title: string; icon: IconName | null; createdAt: number; updatedAt: number; turns: number }`; `AppState` gains `sessions: SessionMeta[]` (most recent first, includes the open one) and `activeSessionId: string`.
  - `StoreApi` gains `newSession(): void` (no-op when the open session has no thread items), `switchSession(id: string): void`, `deleteSession(id: string): void` (deleting the open one opens the most recent other, or a fresh one), `deleteAllSessions(): void` (leaves one fresh empty session).
  - `sessions.ts`: `SESSIONS_KEY = "bb-sessions-v1"`, `MAX_SESSIONS = 20`, `MAX_WIRE_SAVED = 200`; `type SessionSnapshot = { meta: SessionMeta; thread: ThreadItem[]; surfaces: Record<string, SurfaceState>; newestSurfaceId: string | null; wire: WireEntry[]; pool: PoolState }`; `sessionTitle(thread: readonly ThreadItem[]): string`; `sessionIcon(surfaces: Record<string, SurfaceState>): IconName | null`; `sanitizeSnapshot(raw: unknown): SessionSnapshot | null`; `loadSessions(storage: Pick<Storage, "getItem">): SessionSnapshot[]`; `saveSessions(storage: Pick<Storage, "setItem">, snaps: readonly SessionSnapshot[]): boolean`.

- [ ] **Step 1: Write the failing tests** in `sessions.test.ts` and `store.test.ts`:
  - `sessionTitle uses the first utterance, at most 48 characters`: `sessionTitle([user("I want dinner after this event, pick a place nearby and book it")])` → `"I want dinner after this event, pick a place ne…"` (47 chars + "…"); empty thread → `"New session"`.
  - `sessionIcon returns the first Icon brick's name, else null`: surfaces s1 (no Icon) and s2 (Icon name "plane") → `"plane"`; none → `null`; an Icon with a non-literal or unknown name is skipped.
  - `loadSessions skips corrupt JSON and invalid entries`: getItem returns `"{nope"` → `[]`; an array with one valid and one `{}` entry → one snapshot.
  - `saveSessions returns false when storage throws`.
  - `pending turns are restored as stopped`: a snapshot whose agent item is pending or streaming comes back from `sanitizeSnapshot` with that item ended (not pending/streaming).
  - `newSession keeps the old session in the list and starts empty`: after one turn, `newSession()` → `thread.length === 0`, `sessions.length === 2`, old meta has `turns === 1`.
  - `newSession on an empty session does nothing`.
  - `switchSession restores thread, surfaces and wire` (deep-equal to before the switch).
  - `events for a turn of another session are ignored`: begin a turn, `newSession()`, then `applyTurnEvent(oldTurnId, a2ui createSurface)` → new session's `surfaces` stays `{}`.
  - `deleteSession of the open session opens the most recent other`; `deleteAllSessions leaves one empty session`.
  - `totals survive newSession and switchSession`: `totals.turns` unchanged by both.
  - `more than 20 sessions drops the oldest`.
- [ ] **Step 2: Run** `bun test src/client/sessions.test.ts src/client/store.test.ts` — expect the new tests to FAIL (missing exports / methods).
- [ ] **Step 3: Implement** `sessions.ts` and the store methods. Save to localStorage (wrapped in try/catch) when a turn ends (done or failTurn), on newSession / switchSession / delete*, and on clearThread; never per streamed event. On store creation, load saved sessions and open the most recent one, or a fresh one. Snapshots drop recordings, activeTurnId and replaying, and keep the last `MAX_WIRE_SAVED` wire entries.
- [ ] **Step 4: Run** `bun test src/client` and `bunx tsc -b` — PASS.
- [ ] **Step 5: Commit** `feat(stage): sessions in the store, saved in this browser`.

### Task 2: Replays open a fresh session at a sequence start

**Files:** Modify `src/client/replay.ts`, `src/client/replay.test.ts`.

**Interfaces:**
- Consumes: `store.newSession()` (Task 1).
- Produces: `ReplayDeps` gains `newSessionIfBusy: () => void`; `startsSequence(rec: Recording): boolean` (exported) — true when the recording's events include a createSurface for surfaceId `"s1"`.

- [ ] **Step 1: Write the failing tests:** `startsSequence is true for the shipped F1 and F4 and false for F2, F3, F5, F6` (uses `BUILTIN_REPLAYS`); `playing a sequence start calls newSessionIfBusy once before the first event`; `playing F2 does not call it`.
- [ ] **Step 2: Run** `bun test src/client/replay.test.ts` — FAIL.
- [ ] **Step 3: Implement**; the app wires `newSessionIfBusy` to "if the open session has thread items, call store.newSession()". Saved replays (Shift+R) follow the same rule.
- [ ] **Step 4: Run** `bun test src/client/replay.test.ts` — PASS.
- [ ] **Step 5: Commit** `feat(stage): F1 and F4 open a fresh session`.

### Task 3: Layout A shell

**Files:**
- Create: `src/client/stage/StageApp.tsx`, `SessionRail.tsx`, `TopBar.tsx`, `ReplayMenu.tsx`, `VoiceDock.tsx`, `HoodPanel.tsx`, `src/client/shortcuts.ts`
- Modify: `src/client/main.tsx`, `src/client/App.tsx` (use shortcuts.ts), `src/client/index.css`, and split reusable parts out of `src/client/panels/BottomBar.tsx` / `Inspector.tsx` as needed (classic must keep working).

**Interfaces:**
- Consumes: Task 1 store methods; Task 2 `newSessionIfBusy`; `ICONS` from `@/iconMap`; existing `Thread`, `Inspector` wire/data views, `useVoice`, `VoiceGlow`, `sendTurn`, `abortTurn`, `cancelReplay`, `playReplay`, `clearThreadWithWave`.
- Produces: `handleShortcut(s: Shortcut): void` in `shortcuts.ts` (the Esc/F-key/mode/decision/save/export handler now in App.tsx, shared by both layouts); `switchToSession(id: string)`, `startNewSession()`, `removeSession(id: string)`, `removeAllSessions()` in `shortcuts.ts` — each calls `abortTurn()` and `cancelReplay()` first.

- [ ] **Step 1: Build the shell** to the artifact's section A, at 1600×900 and 1920×1080:
  - **Rail:** brand mark + "Brick Box" + "Built from a box of bricks"; "New session" (square-pen icon); "Sessions" list rows (session icon from `meta.icon` via `ICONS`, else message-square; title; "N turns · HH:mm"); row hover shows a delete (trash) button; a rail menu with "Delete all sessions" using an in-page confirm ("Delete all N sessions? This can't be undone." / "Delete all" / "Cancel"); footer "Answer with" segmented control Widgets 1 / HTML 2 / A2UI 3, Decision model toggle, Hands-free toggle.
  - **Top bar:** session icon + title; a mono line "a2ui · <composer model>" (mode + model as shown in today's turn chips); buttons "Replays" (history icon → ReplayMenu listing F1–F6 as "F1 · <display>", empty slots disabled) and "Clear conversation" (eraser icon; same as Esc).
  - **Stream:** the existing Thread, centred, content width 640–720 px.
  - **Voice dock:** floating, centred at the bottom of the main column, max 720 px: mic button with the existing voice glow, status line ("Hold Space to talk", live transcript while listening, errors), typed-request field (Enter sends).
  - **Hood panel:** header "Under the hood" (cpu icon); tabs Bricks (default) / Wire (count) / Data; body = Task 4's tiles (temporary placeholder until Task 4 lands) or the existing wire/data views; footer metrics Turns / LLM calls avoided / Tokens from `state.totals`.
- [ ] **Step 2: Wire `main.tsx`:** `?classic` renders the old App; otherwise StageApp. Both keep the key box.
- [ ] **Step 3: Run** `bunx tsc -b` and `bun test` — PASS (no behaviour tests change).
- [ ] **Step 4: Browser check** (production build served statically; open with `?k=x`, replays need no API): F1–F3, New session, F4–F6, switch back to the dinner session (its screens return), Clear conversation, Delete all (confirm), `?classic` still renders. Save 1920×1080 and 1366×768 screenshots to the session scratchpad.
- [ ] **Step 5: Commit** `feat(stage): layout A shell with sessions rail, top bar, voice dock and hood panel`.

### Task 4: Brick pool tiles with drawn glyphs

**Files:** Create `src/client/stage/glyphs.tsx`, `src/client/stage/BrickTiles.tsx`, `src/client/stage/glyphs.test.ts`; Modify `HoodPanel.tsx`.

**Interfaces:**
- Produces: `BRICK_GLYPHS: Readonly<Record<string, ReactNode>>` (28×20 viewBox drawings for the 17 current bricks plus Icon, Table, Chart, Timeline, Image, Badge, Alert, Accordion, Progress, Rating — copy the drawings from the artifact source); `NEW_BRICK_NAMES: ReadonlySet<string>` (those ten); `BrickTiles({ pool }: { pool: PoolState })`.

- [ ] **Step 1: Write the failing test:** `every catalog brick has a glyph` (`BRICKS.every((b) => b.name in BRICK_GLYPHS)`); `the ten new names have glyphs`.
- [ ] **Step 2: Run** `bun test src/client/stage` — FAIL.
- [ ] **Step 3: Implement** a 3-column grid grouped by catalog group with labels; tile = glyph + poolLabel; states used (filled accent), heard (= predicted; accent outline), idle; a dot on names in `NEW_BRICK_NAMES`; legend used / heard / idle / new. State changes are colour only (no size shift).
- [ ] **Step 4: Run** `bun test src/client/stage` and `bunx tsc -b` — PASS.
- [ ] **Step 5: Commit** `feat(stage): brick pool tiles with drawn glyphs`.

### Task 5: Fold earlier turns

**Files:** Modify `src/client/format.ts`, `src/client/format.test.ts`, `src/client/panels/Thread.tsx` (new prop `foldEarlier?: boolean`, default false so classic is unchanged), `StageApp.tsx` (passes true).

**Interfaces:**
- Produces: `openTurnIds(timeline: Timeline, interactiveSurfaceId: string | null): Set<string>` in `format.ts` — the newest turn plus the turn that owns the interactive surface (the patched screen stays open).

- [ ] **Step 1: Write the failing tests:** `newest turn and the interactive surface's turn stay open`; `after a patch turn, the patched screen's turn stays open`; `a single turn is open`.
- [ ] **Step 2: Run** `bun test src/client/format.test.ts` — FAIL.
- [ ] **Step 3: Implement** the folded row: mic or keyboard icon by `via`, the utterance, "→" and the turn's caption (else "N bricks"), and its compose time; click toggles open; keyboard accessible (button).
- [ ] **Step 4: Run** `bun test src/client` — PASS.
- [ ] **Step 5: Commit** `feat(stage): earlier turns fold to one line`.

### Task 6: Finish, responsive pass, docs, checks

**Files:** Modify stage components and `index.css` as needed; `HANDOFF.md` (stage flow: New session between scenarios, F1/F4 open a fresh session, Delete all sessions before the talk, `?classic` fallback; replay map without "Esc between F3 and F4"); `NOTES.md` (browser-check results).

- [ ] **Step 1:** Breakpoint below 1440 px (rail 220, panel 320); dock never covers the newest screen's primary button (stream bottom padding ≥ dock height + 24 px); focus-visible rings on every control; reduced-motion respected; consistent icon sizes.
- [ ] **Step 2: Run** `bun test` and `bunx tsc -b` — PASS.
- [ ] **Step 3: Browser check** as in Task 3 Step 4 plus 1366×768: no horizontal scroll; screenshots saved; results written to NOTES.
- [ ] **Step 4: Commit** `feat(stage): responsive finish; docs for the new stage flow`.
