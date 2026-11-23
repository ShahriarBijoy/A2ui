# Brick Box — agent guide

Voice-driven generative UI demo for a 5-minute live talk. **Reliability on stage beats features.**
Spec: `PLAN.md` (authoritative). Verified API facts and rulings: `NOTES.md` (read before any external API call).

## Commands
- `bun run dev` — Vite + Worker (workerd) on http://localhost:5173. Open with `?k=<DEMO_KEY>` from `.dev.vars`.
- `bun test` — unit tests (bun test). `bunx tsc -b` — typecheck (TS 7, strict).
- `bun run deploy` — build + wrangler deploy (only on the owner's personal Cloudflare account).

## Layout
- `src/shared/` — code used by both sides. **Contract files** (`a2ui.ts`, `catalog.ts`, `protocol.ts`, `pointer.ts`) and `src/client/state.ts` change only with the controller's agreement.
- `src/worker/` — Hono Worker: auth, `/api/turn` (SSE), `/api/predict`, `/api/soniox-key`.
- `src/client/` — React app. `@/` → `src/client/`, `@shared/` → `src/shared/`. shadcn components in `src/client/components/ui`.

## Rules
- Check docs before calling an external API; record differences in NOTES.md.
- Never show a number that was not measured. No secrets in the client (all keys are Worker secrets; `.dev.vars` locally).
- One page. No router, no SSR, no database. TypeScript strict; no `any` in A2UI types.
- Every turn event enters the client through `store.applyTurnEvent` (single ingress; replay depends on it).
- Visual style: flat, borders instead of shadows, tokens in `src/client/index.css`. Respect `prefers-reduced-motion`.
- Conventional commits with the step number, e.g. `feat(step-3): bricks and renderer`.
