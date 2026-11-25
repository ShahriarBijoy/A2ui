# Generative UI Is the Future. A Decision Model Makes It Work.

A playground that tests one pattern for generative UI: **a large model builds each screen, and a small decision model handles the edits that follow.**

Hold Space and ask for something, like *"I want dinner after this event, pick a place nearby."* Claude answers with a screen instead of text. Then say *"We're six, and later."* and the same screen changes in about 0.2 seconds, without calling the large model.

Shown live at [AI Tinkerers Bremen](https://bremen.aitinkerers.org/) on 25 November 2026.

## The idea

| | Who builds the screen | Can it show something new? | Safe? |
|---|---|---|---|
| **Hand-built widgets** | A developer, months before | No. Only what someone planned | Yes |
| **AI writes HTML or React** | The AI writes code, the browser runs it | Yes | No. Its code runs in your app |
| **A2UI** (this playground) | The AI picks components, the app draws them | Yes | Yes. The AI sends data, never code |

[A2UI](https://a2ui.org) is an open protocol that Google started. The agent sends JSON that names components from a fixed catalog, says how they are arranged, and gives the data. The app already has the code for every component. It reads the JSON and draws them. A name that is not in the catalog is not drawn.

Generative UI has a cost: every new screen is a large-model call. Most turns in an app are small changes, though: one more person, a later time. A small decision model can handle those.

## How it works

```
  you speak ─► Soniox (speech to text) ─► Cloudflare Worker  /api/turn
                                                 │
                                   Jev decision model (~150 ms):
                                   a change to this screen, or something new?
                         ┌───────────────────────┴───────────────────────┐
                  a change, and sure                               something new
                  the app writes the new values                    Claude Sonnet 5.5 streams
                  (A2UI updateDataModel), no LLM                   A2UI messages
                         └───────────────────────┬───────────────────────┘
                                                 ▼
                     the browser checks each message against the catalog
                     and draws only the 27 components it knows (React + shadcn/ui)
```

- **Data, not code.** The catalog is `src/shared/catalog.ts`: 27 components ("bricks"), from Card and List to a seat map and a chart. The agent never writes HTML or JavaScript. An unknown component shows a "Not in the catalog" placeholder. A tap goes back to the app's own server as an action.
- **The decision model.** [Jev](https://typesafe.ai) by TypeSafe answers fixed questions with a choice and a confidence. It does not write anything. While you speak, it guesses which bricks the request is about (the outlined tiles in the brick panel). When you stop, it decides: change or new? For a change, it picks the new values from the ones the screen allows.
- **Live facts.** Places, events and fares come from a live web search (Claude Haiku 5.5). Weather comes from [Open-Meteo](https://open-meteo.com). The results go straight to the screen; the composer never reads them. If nothing is found, the list says so. Nothing is invented.
- **Three modes to compare.** A2UI (bricks), Widgets (hand-built components) and HTML (the model writes the page, shown in a sandboxed frame).
- **Cost meter.** Every turn shows what it cost: measured tokens × list price, plus the web search fee. The total for the visit is next to the turn counters.

## Measured

On the live deployment, November 2026. Details are in `NOTES.md`.

- An edit through the decision model: about 0.2 s and no large-model tokens. A new screen: 3 to 5 s.
- The decision model routed 30 of 30 test sentences correctly.
- A new screen cost $0.008 to $0.029 at list prices (less once the prompt is cached). An edit through the decision model cost less than $0.001.

## Known limits

- The agent can only use the components in the catalog. A request outside it (a login form, a new color scheme) gets a "Not available" card.
- A2UI limits what the AI can do. It does not make the AI correct: it can still show a wrong value.
- The Image brick loads a picture from any http(s) address, and the `formatString` function can put a value from the screen into that address. A typed value could leave that way. Found by reading the code; not fixed yet. The fix is to load only addresses that came from the server.
- The cost meter leaves out speech to text and the brick guesses. TypeSafe publishes no price list, so the Jev share uses third-party listings and only ever shows as "<$0.001".

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
| F1–F6 | Play saved replays (no network needed) |
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
src/client   React app: A2UI renderer and bricks, voice input, thread and hood panels
src/worker   Hono Worker: turn stream, composer prompt, decision model, web search, weather
src/shared   A2UI types, the brick catalog, the client/server protocol, prices for the cost meter
scripts      smoke test and evals against a running server (bun run smoke)
```

`PLAN.md` is the original spec. `NOTES.md` records measurements and design decisions. `TALK.md` is the talk script.

## Tests

```bash
bun test        # unit tests
bunx tsc -b     # type check
```

## Built with

A2UI v1.0 · Claude Sonnet 5.5 (builds the screens) and Claude Haiku 5.5 (web search, Widgets and HTML modes) · Jev by TypeSafe · Soniox · Open-Meteo · React 19 · Vite · Tailwind CSS 4 · shadcn/ui on Base UI · Hono · Cloudflare Workers
