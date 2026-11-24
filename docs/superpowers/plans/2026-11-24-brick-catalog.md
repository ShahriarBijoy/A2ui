# Brick Catalog (27 bricks) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ten bricks (Icon, Table, Chart, Timeline, Image, Badge, Alert, Accordion, Progress, Rating) and an optional `icon` on OptionCard and Button, end to end: types, catalog, validation, renderers, composer prompt, search image enrichment, smoke judge, talk-clock eval.

**Architecture:** The catalog (`src/shared/catalog.ts`) stays the single source for the prompt, validation and Jev prediction. New component types in `src/shared/a2ui.ts`, prop rules in `processor.ts` `validateProps`, renderers in `src/client/a2ui/bricks/`. Image URLs never come from the model: the Worker reads each search record's source page `og:image` and sends a second data update.

**Tech Stack:** TypeScript 7 strict, React 19, shadcn on Base UI (accordion, progress components already installed), lucide-react, Hono Worker, bun test.

**Spec:** `docs/superpowers/specs/2026-11-24-stage-redesign-design.md` (Track 2 of its "Two tracks"; table "New bricks").

## Global Constraints
- A2UI v1.0 message shapes unchanged; new bricks are catalog components under the existing catalogId.
- Contract changes allowed: `src/shared/a2ui.ts` (new component types, `icon?` on OptionCard/Button), `src/shared/catalog.ts` (ten entries). `src/shared/protocol.ts`, `pointer.ts`, `src/client/state.ts`: unchanged.
- Icon names: only `ICON_NAMES` from `src/shared/icons.ts` (already on master); renderer map `ICONS` in `src/client/iconMap.tsx`.
- Image url and Rating value only from a data line (live search); the composer never writes them. Unknown → nothing shown.
- Tables, Charts and Timelines are read-only; anything the person picks stays an OptionCard. At most 7 visible blocks still holds.
- No new runtime dependencies (recharts exists, but plain SVG/CSS bars are preferred).
- At most 3 live searches per turn (unchanged). The static system prompt stays free of volatile values (it is prompt-cached).
- Eval at the talk clock (`DEV_NOW=2026-11-25T18:45`) against the Worker served in-process with Bun (no `bun run dev` / `wrangler dev`: low memory): flight `--runs 10 --strict` ≥ 9/10; dinner `--runs 10` ≥ 9/10 with real places and the "We're six, and later." patch judged by result; held-out `--runs 1`. Record every number with its commit in NOTES.md. Never print secrets from `.dev.vars`.
- Commits: conventional, explicit paths, no attribution trailers.

## Review Focus
1. The composer writes an Image url or Rating value itself: the smoke judge fails the step (Task 4 test).
2. An image URL that 404s or blocks hotlinking: the Image hides, no broken-image icon, no layout jump (Task 2 test).
3. Table / Chart / Timeline bound to a path with no data yet, or with null cells: skeleton while the surface streams, a quiet empty state after, null cells blank (Task 2 tests).
4. Unknown icon name or a bad variant: that brick is refused with the calm placeholder and the rest of the surface renders (Task 1 tests).
5. A slow, huge or non-HTML source page during og:image lookup: capped at 1500 ms and 64 KB per page, never delays the records (Task 3 tests).

---

### Task 1: Types, catalog entries, validation

**Files:** Modify `src/shared/a2ui.ts`, `src/shared/catalog.ts`, `src/client/a2ui/processor.ts` (`validateProps`), every child-id walker (grep the Tabs `tabs[].child` walks: client `Surface.tsx`, `src/worker/turn.ts` reachability, `scripts/smoke.ts` render order / orphans / visible blocks); Test: `src/client/a2ui/processor.test.ts`, catalog test (new `src/shared/catalog.test.ts` if none).

**Interfaces (produced, `a2ui.ts`):**
- `IconComponent = Base<"Icon"> & { name: IconName; size?: "sm" | "md" | "lg" }`
- `TableComponent = Base<"Table"> & { columns: { label: DynamicString; field: string }[]; rows: PathBinding | JsonObject[] }`
- `ChartComponent = Base<"Chart"> & { type?: "bar"; items: PathBinding | { label: string; value: number }[]; unit?: DynamicString }`
- `TimelineComponent = Base<"Timeline"> & { items: PathBinding | { title: string; time?: string; detail?: string }[] }`
- `ImageComponent = Base<"Image"> & { url: DynamicString; alt: DynamicString; aspect?: "wide" | "square" }`
- `BadgeComponent = Base<"Badge"> & { text: DynamicString; variant?: "neutral" | "success" | "warning" | "danger" }`
- `AlertComponent = Base<"Alert"> & { title?: DynamicString; text: DynamicString; variant?: "info" | "warning" | "success" }`
- `AccordionComponent = Base<"Accordion"> & { items: { title: DynamicString; child: string }[] }`
- `ProgressComponent = Base<"Progress"> & { value: DynamicNumber; max?: number; label?: DynamicString }`
- `RatingComponent = Base<"Rating"> & { value: DynamicString | DynamicNumber; max?: number }`
- OptionCard and Button gain `icon?: IconName`.
- Catalog entries (group / custom): Icon content/false, Image content/false, Table layout/true, Accordion layout/true, Chart, Timeline, Badge, Alert, Progress, Rating content/true; each with poolLabel, a one-line purpose, the props string as the composer sees it (from the spec table) and a predictHint.

- [ ] **Step 1: Write the failing tests:** `catalog has 27 unique bricks with purpose, props and predictHint`; `Icon with an unknown name is refused`; `Icon size outside sm|md|lg is refused`; `Table without columns is refused`; `Table rows may be a path or a literal array`; `Chart items must be a path or an array of {label, value}`; `Image without alt is refused`; `Badge and Alert reject unknown variants`; `Accordion items must name child ids and those children are reachable`; `Rating max must be between 1 and 10`; `OptionCard icon outside the icon set is refused`; `a refused new brick leaves the rest of the surface rendering`.
- [ ] **Step 2: Run** `bun test src/client/a2ui src/shared` — FAIL.
- [ ] **Step 3: Implement** types, entries and `validateProps` cases; add Accordion `items[].child` beside Tabs in every child walker.
- [ ] **Step 4: Run** `bun test` and `bunx tsc -b` — PASS (the `BRICK_COMPONENTS` mapped type will demand renderers: add one-line placeholders that render `<Refused type=… reason="Not built yet" />` so this task stands alone; Task 2 replaces them).
- [ ] **Step 5: Commit** `feat(bricks): ten new catalog bricks and icon props, typed and validated`.

### Task 2: Renderers

**Files:** Create `src/client/a2ui/bricks/{Icon,Table,Chart,Timeline,Image,Badge,Alert,Accordion,Progress,Rating}.tsx`, `src/client/a2ui/bricks/items.ts`, `src/client/a2ui/bricks/items.test.ts`; Modify `bricks/index.ts`, `OptionCard.tsx`, `Button.tsx`.

**Interfaces:**
- Produces (`items.ts`): `resolveItems(binding: PathBinding | JsonValue[], data: JsonValue, scope: string, streaming: boolean): { kind: "skeleton" } | { kind: "empty" } | { kind: "items"; items: JsonObject[] }` (same skeleton/empty rule as List templates in `template.ts`); `parseRating(v: JsonValue | undefined, max?: number): { value: number; max: number } | null` (`"4.5/5"` → {4.5, 5}; `4.2` → {4.2, 5}; `"8.7/10"` → {8.7, 10}; `"great"`, null, negative or > max → null); `barWidths(values: readonly number[]): number[]` (percent of the largest; all-zero → zeros).

- [ ] **Step 1: Write the failing tests** in `items.test.ts` for the three helpers with the values above, plus `resolveItems: a path with no data is a skeleton while streaming and empty after`, `null cells stay null`.
- [ ] **Step 2: Run** `bun test src/client/a2ui/bricks` — FAIL.
- [ ] **Step 3: Implement** the helpers and renderers: Icon (`ICONS[name]`, 16/20/28 px, aria-hidden); Table (header row, cells read `field`, null → blank, horizontal scroll inside its own box); Chart (horizontal bars on one scale, value labels with unit, ≤ 12 items); Timeline (vertical, time in mono); Image (fixed aspect box 16:9 or 1:1, skeleton until load, hidden on error, `referrerPolicy="no-referrer"`, `loading="lazy"`); Badge (variant colours from tokens); Alert (info / triangle-alert / circle-check icon); Accordion (shadcn accordion, children rendered through the surface); Progress (shadcn progress + label + value); Rating (five stars with partial fill from `parseRating`, numeric value beside); OptionCard and Button render `icon` before the title / label.
- [ ] **Step 4: Run** `bun test` and `bunx tsc -b` — PASS.
- [ ] **Step 5: Commit** `feat(bricks): renderers for the ten new bricks and icon props`.

### Task 3: Composer prompt rules and image enrichment

**Files:** Modify `src/worker/prompts.ts`, `src/worker/prompts.test.ts`, `src/worker/search.ts` (`SERVER_FIELDS` gains `image`), `src/worker/turn.ts`, `src/worker/turn.test.ts`; Create `src/worker/ogImage.ts`, `src/worker/ogImage.test.ts`.

**Interfaces:**
- Produces (`ogImage.ts`): `OG_IMAGE_TIMEOUT_MS = 1500`, `OG_IMAGE_MAX_BYTES = 65536`; `extractOgImage(html: string, pageUrl: string): string | null` (`og:image`, `og:image:secure_url`, `twitter:image`; relative URLs resolved against pageUrl; http(s) only); `fetchOgImages(urls: readonly (string | null)[], fetchImpl: typeof fetch, signal: AbortSignal): Promise<(string | null)[]>` (parallel; per-page timeout; reads at most the byte cap; non-HTML content-type → null).
- turn.ts: a search whose requested fields include `image` delivers its records first (each with `image: null`), then, if any page yields an image, one more `updateDataModel` for the same path with the images filled in (origin "data"). It counts as no extra search and stops with the turn.

- [ ] **Step 1: Write the failing tests:** `extractOgImage reads og:image`, `falls back to twitter:image`, `resolves a relative URL`, `ignores non-http URLs`, `returns null without a tag`; `fetchOgImages returns null on timeout, non-HTML and errors`, `stops reading after the byte cap`; turn: `image field: records first, then one update with image urls`, `no image found: no second update`, `the model is never asked for image` (search prompt keys exclude it); prompts: `composer prompt names every icon and the data-only rule for Image and Rating`.
- [ ] **Step 2: Run** `bun test src/worker` — FAIL.
- [ ] **Step 3: Implement.** Prompt additions (DATA / COMPONENTS area, static): Image.url and Rating.value only from a data line's fields (request `image` or `rating` in fields), never written yourself; Table, Chart and Timeline for read-only comparisons, numbers and schedules, while items the person picks stay OptionCards; Icon names come from this list: (ICON_NAMES joined with ", "). Keep the existing rules and the 7-block limit.
- [ ] **Step 4: Run** `bun test` and `bunx tsc -b` — PASS.
- [ ] **Step 5: Commit** `feat(bricks): composer rules for new bricks; og:image enrichment for search records`.

### Task 4: Smoke judge, held-out lines, talk-clock eval

**Files:** Modify `scripts/smoke.ts`, `scripts/smoke.test.ts`, `src/shared/scenarios.ts` (held-out lines), `NOTES.md`.

**Interfaces:**
- Produces: `dataOnlyViolations(surface: SurfaceState, delivered: ReadonlySet<string>): string[]` in `smoke.ts` — ids of Image / Rating components whose shown url / value is not among the values delivered by data events in that session (literal copies of delivered values are fine).

- [ ] **Step 1: Write the failing tests:** `an Image url not delivered by data is a violation`; `a Rating value copied from delivered data is fine`; `no Image or Rating: no violations`.
- [ ] **Step 2: Run** `bun test scripts/smoke.test.ts` — FAIL.
- [ ] **Step 3: Implement**; a step with violations fails with the note "invented: <ids>". Add three held-out lines (test inputs only, never prompt text): "Compare the three cheapest mobile phone plans in Germany.", "Plan a Saturday in Hamburg for two of us, with times.", "Show me a nice café near the venue with a photo and its rating."
- [ ] **Step 4: Run** `bun test` — PASS. Then the eval (in-process server, talk clock): flight `--runs 10 --strict`, dinner `--runs 10`, held-out `--runs 1`. Bars: flight ≥ 9/10, dinner ≥ 9/10. Record results with the commit in NOTES; if a bar is missed, stop after at most one prompt revision and report the numbers.
- [ ] **Step 5: Commit** `test(bricks): data-only judge, held-out lines, talk-clock eval`.
