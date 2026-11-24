# Brick Box

**Say what you need. The screen builds itself.**

Brick Box is a voice-driven generative UI. Hold Space and ask for something, like *"I want dinner after this event, pick a place nearby."* Claude answers with an interface instead of text. It composes the screen from a fixed set of 17 UI components ("bricks"), sent as [A2UI](https://github.com/google/A2UI) messages, and the browser renders them with shadcn/ui.

Small follow-ups such as *"We're six, and later."* change the screen in about 0.2 s. A decision model turns them into data updates without calling the LLM.

Built for a 5-minute live demo at AI Tinkerers Bremen.

## How it works

```
  you speak ─► Soniox (speech to text) ─► Cloudflare Worker  /api/turn
                                                 │
                         ┌───────────────────────┴───────────────────────┐
                 a change to this screen?                          anything new
                 Jev decision model                                Claude composer
                 → small data patch, no LLM                        → A2UI messages, streamed
                         └───────────────────────┬───────────────────────┘
                                                 ▼
                              browser renders the bricks (React + shadcn/ui)
```

- **Data, not code.** The agent can only use the bricks in `src/shared/catalog.ts`. It sends JSON that describes the screen and never writes HTML or JavaScript.
- **Live facts.** Places, events and prices come from a live web search. Lists show placeholders until the results arrive.
- **Three modes to compare.** A2UI (bricks), Widgets (hand-built components) and HTML (the model writes markup).

## Run it locally

You need [Bun](https://bun.sh) and API keys for Anthropic, Soniox and TypeSafe (Jev).

```bash
bun install
cp .dev.vars.example .dev.vars   # add your keys; DEMO_KEY is any password you choose
bun run dev                      # http://localhost:5173
```

Open the page and enter your `DEMO_KEY` once. The browser remembers it.

## Controls

| Key | Action |
| --- | --- |
| Space (hold) | Talk |
| Enter | Send a typed request |
| 1 / 2 / 3 | Widgets / HTML / A2UI mode |
| D | Decision model on or off |
| Esc | Clear the screen |
| F1–F6 | Play saved replays (work offline) |
| Shift+R / Shift+E | Save the last turn / export saved replays |

## Deploy to Cloudflare Workers

Set `account_id` in `wrangler.jsonc` to your account, then:

```bash
bunx wrangler login
bunx wrangler secret put ANTHROPIC_API_KEY   # also SONIOX_API_KEY, JEV_API_KEY, DEMO_KEY
bun run deploy
```

All `/api` routes need the demo key and are rate limited per IP. API keys stay on the Worker and never reach the browser.

## Project layout

```
src/client   React app: A2UI renderer and bricks, voice input, panels
src/worker   Hono Worker: turn stream, composer prompt, web search, decision model
src/shared   A2UI types, the brick catalog, the client/server protocol
scripts      smoke test against a running server (bun run smoke)
```

`PLAN.md` is the original spec. `NOTES.md` records measurements and design decisions.

## Tests

```bash
bun test        # unit tests
bunx tsc -b     # type check
```

## Built with

Vite · React 19 · Tailwind CSS 4 · shadcn/ui on Base UI · Hono · Cloudflare Workers · Claude (Sonnet 5.5 composes, Haiku 5.5 searches) · Soniox · Jev by TypeSafe
