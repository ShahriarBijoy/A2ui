# The Future Is Generative UI: the talk

AI Tinkerers Bremen · Wed 25 Nov 2026 · JAAI, Überseestadt · 5 minutes

**The story:** a concept exploration of generative UI, shown in a small playground, told as one evening, live. The meetup ends, you're hungry, friends change plans, tomorrow you fly. Every screen is built on the spot from a box of bricks. Then you show two other ways to build it, let the room ask for something, open the hood, and close.

**The three claims** (from the plan, keep them):
1. UI can be generated for the moment: the agent builds the screen you need right now.
2. A small decision model makes it fast and cheap: most small steps need no big model.
3. The experience decides: say it once, see it at once, change it in place.

**Before you go on stage**
- Open the site on the stage laptop, enter the demo key once, allow the mic.
- Rail menu (⋯) → **Delete all sessions**, so no rehearsal titles show on the projector.
- Mode **A2UI** (key 3), **Decision model** on.
- Close other tabs. Wi-Fi on. Mic tested with one "hello".

---

## The script

*Lines in quotes are what you say. [Brackets] are what you do. Times are rough marks, not a race. The pauses while a screen builds are yours: let the room watch it build.*

### 0:00 · The hook
[Empty screen. Bricks panel open on the right.]

"Hi, I'm Shahriar.
Quick question. How many apps did you open today?
Every one of them had screens that somebody designed months ago,
for questions somebody guessed in advance.

Tonight I want to try something different.
This playground has no screens.
It has a box of bricks." [point at the bricks panel]
"Twenty-seven of them. Cards, buttons, a seat map, a chart.
And an agent that picks the bricks while I talk."

### 0:30 · Dinner
"So. This meetup ends in an hour, and I'm already hungry.
Let me just ask."

[Hold Space] **"I want dinner after this event. Pick a place nearby."** [release]

[While it builds, point at the bricks panel]
"Watch the right side. The bricks it heard light up first…
and now the ones it really used.
And these places are real. It searched the web just now, from here, from Überseestadt."

### 0:55 · One decision at a time
[Tap a place]
"I tap one.
And look, no big form. It asks one thing at a time: what time, how many people."

### 1:10 · We're six, and later
"Then my friends text me. Of course they do."

[Hold Space] **"We're six, and later."** [release]

[Point at the guests and the time]
"Six people. One hour later. Same screen, it just changed in place.
And look here." [point at the turn line: "decision model", "compose –"]
"No language model was called for this. Zero generated tokens.
A small decision model, Jev from TypeSafe, understood the sentence and turned two knobs.
That took about this long." [point at the time on screen]

"That's the second idea tonight.
The big model builds the screen once.
A small, fast model takes care of the little steps after."

### 1:45 · Tomorrow's flight
"Okay. Dinner is sorted. Tomorrow I have to fly."

[Click **New session**]

[Hold Space] **"I need to book a flight tomorrow."** [release]

"It already knows tomorrow's date, and that I'm in Bremen.
It only asks for what it doesn't know."

[Hold Space] **"To New York, give me options."** [release]

"Real fares, from the web.
And it does not make up prices. If it can't find one, it shows nothing."

### 2:20 · A seat map nobody designed
[Tap a flight]
"And because flights have seats… it gives me a seat map.
Nobody designed this screen. Ten seconds ago it didn't exist."

### 2:35 · Two other ways to build this
"Now you could say: we've had chatbots for years.
So let me show you two other ways to build exactly this."

[Press **1**: Widgets]
"Way one: widgets. This is how most assistants do it today.
A developer built a flight widget in advance."

[Hold Space] **"I need a flight from Bremen to New York tomorrow."** [release]

"Looks fine. Now I want a seat."

[Hold Space] **"Pick me a window seat."** [release]

"And we get… text. The widget simply has no seat map.
Somebody has to write new code and ship it."

### 3:05 · HTML: open, but not safe
[Press **2**: HTML]
"Way two: let the model write the page itself. HTML. Anything goes."

[Hold Space] **"Make the page pink and add a login box."** [release]

"And… it does it. A login box. From one sentence.
That's the problem. It's open, but it's not safe."

### 3:30 · Back to the box
[Press **3**: A2UI]
"Back to the bricks. Same sentence."

[Hold Space] **"Make the page pink and add a login box."** [release]

"Not available.
The agent can only use what's in the box. No scripts, no login forms.
It sends data, not code."

### 3:45 · Your turn
"Okay, your turn.
Somebody shout something you'd want to see tonight."

[Repeat the request out loud so the room hears it, then hold Space and say it.]

[While it builds] "Nobody planned this one. Let's see what it builds."

*If nobody speaks up within five seconds, use one of these:*
- "Will it rain when we walk to dinner?"
- "Split a hundred and twenty euros between four of us. Jonas only had drinks."
- "Plan a Saturday in Hamburg for two of us, with times."

### 4:15 · Under the hood
[Open **Under the hood → JSON stream**]
"And this is everything the agent sent.
Line by line. A column, a heading, a list of cards, a seat map.
Data, not code.
Any app that has the same bricks can draw it. That's A2UI, Google's open protocol for this."

### 4:35 · Close
"So, three things.

Widgets are safe, but closed.
Generated HTML is open, but unsafe.
Generative UI from a box of bricks is open, and safe.

A big model writes the screen once. A decision model takes the small steps.
Tonight that was **N** out of **M** turns, with no generated tokens." [read N and M from the counters at the bottom right: LLM CALLS AVOIDED and TURNS]

"And none of this matters if it feels slow or jumpy.
The experience is the product.
Say it once. See it at once. Change it in place.

Thank you."

---

## If something goes wrong

Say it calmly, it's a live demo, the room is on your side.

| What happens | What you do | What you can say |
|---|---|---|
| The mic doesn't pick you up | Click "Or type a request", type the same line, Enter | "The mic is shy tonight, I'll type." |
| A turn hangs for more than ~10 s | Press the F-key for that beat (table below) | "Let me show you the run from this afternoon. Same events, same timing." |
| Wi-Fi or the API is down | Use F1–F6 for the whole story; they work offline | "The network left the party. Here's the recording, nothing is faked, it's the real event stream." |
| The audience asks for something odd | Let it build; a "Not available" card is a good answer too | "That's outside the box, and it tells you so." |
| A list says "Nothing found" | Move on, or press the F-key | "The web had nothing for that one. It doesn't invent things." |

**Replay keys (F-keys), work without Wi-Fi:**
| Key | Beat |
|---|---|
| F1 | "I want dinner after this event…" (opens a fresh session by itself) |
| F2 | Tap a place → time + guests |
| F3 | "We're six, and later." (the decision-model edit) |
| F4 | "I need to book a flight tomorrow." (opens a fresh session by itself) |
| F5 | "To New York, give me options." |
| F6 | Tap a flight → seat map |

Replays don't change the turn counters, so the closing N of M stays honest. If you replayed most of the demo, say "tonight's live turns" or skip the numbers.

---

## Other use cases (for the audience moment, Q&A or a different story)

| Say | What it builds | Ready? |
|---|---|---|
| "I want dinner after this event, pick a place nearby." | Live places as cards, then time + guests | Tested many times (talk clock and live) |
| "We're six, and later." | Same screen edited in place, no LLM | Tested |
| "I need to book a flight tomorrow." → "To New York, give me options." → tap | Form, live fares, seat map | Tested |
| "Concerts in Hamburg this weekend." | Live events as cards | Worked live on 24 Nov |
| "Split a 120 euro bill between four, Jonas only had drinks." | Numbers, totals per person | Worked in earlier tests; rehearse once |
| "Packing list for New York in November." | A checklist (no web search needed) | Worked in earlier tests; rehearse once |
| "Compare the three cheapest mobile phone plans in Germany." | A comparison table (new brick) | In the test set; rehearse once |
| "Plan a Saturday in Hamburg for two of us, with times." | A timeline (new brick) | In the test set; rehearse once |
| "Show me a nice café near the venue with a photo and its rating." | Cards with photo and rating (new bricks) | Photos not yet seen live; rehearse before using |
| "Will it rain when we walk to dinner?" / "What's the weather in Bremen today?" | Current weather, hourly chart, 7-day list | Being built now; only use after it's live and rehearsed |

**Two other stories you could tell instead** (same structure, swap the beats):
- **A weekend in Hamburg:** "Plan a Saturday in Hamburg for two" (timeline) → "Any concerts?" (live events) → "Will it rain?" (weather) → "We'll take the train, show me options." Good if you want to avoid the flight.
- **The bill after dinner:** "We were six, split 180 euros, two of us only had drinks." (numbers) → "Actually Jonas paid the wine, 40 euros." (changes in place) Short and funny, but rehearse it first.

---

## Rehearsal checklist
1. Run the full script twice with the mic, out loud, with a timer. Aim for 4:40 so you have room.
2. Say each line exactly as written; the shorter the sentence, the better the mic and the agent handle it.
3. Practice the three key moments: pointing at the bricks lighting up, pointing at "decision model · compose –", and reading N of M.
4. Try F1–F6 once with Wi-Fi off.
5. Before going on: Delete all sessions, A2UI mode, decision model on.
