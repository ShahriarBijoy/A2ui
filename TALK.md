# Generative UI Is the Future. A Decision Model Makes It Work.

AI Tinkerers Bremen · Wed 25 Nov 2026 · JAAI, Überseestadt · 5 minutes

Published as an artifact: https://claude.ai/artifact/7hBKDMHow71z8f1jD1CjvK (keep the two in sync).
Background (how A2UI works, what Jev does, why AI code is unsafe): https://claude.ai/artifact/MNhXViYWFLmG27T2Nc3eJh

## The idea in one table

This is what the room should remember.

| | Who builds the screen | Can it show something new? | Safe? |
|---|---|---|---|
| **Hand-built widgets** | A designer or developer, months before | No. Only what someone planned | Yes |
| **AI writes HTML or React** | The AI writes code | Yes | No. The browser runs its code |
| **A2UI** (a box of bricks) | The AI orders bricks, the app draws them | Yes | Yes. The AI sends data, never code |

**And the decision model makes it work:** the big model builds a screen once, and a small decision model handles the small changes after. That keeps it fast and cheap.

**Before you go on stage**
- Open the site on the stage laptop, **hard-reload it (Ctrl+Shift+R)** so the cost meter shows, enter the demo key once, allow the mic.
- Rail menu (⋯) → **Delete all sessions**, so no rehearsal titles show on the projector.
- Mode **A2UI** (key 3), **Decision model** on.
- Close other tabs. Wi-Fi on. Test the mic with one "hello".

---

## The script

*Plain paragraphs are what you say. [Brackets] are what you do. Lines marked **Say to the app** go to the mic: say them exactly like this. Times are rough marks.*

## Part 1 · Why generative UI

### 0:00 · Opening
[Empty screen. Bricks panel open on the right.]

Hi, I'm Ali. I'm finishing my master's at Uni Bremen, and I play with AI tools every day, in my life and at work. Recently I came across A2UI, an open project that Google started, and I found it fascinating.

These days anyone can build an app, and almost every app or platform has an AI or an agent inside it. So how do you keep users coming back? You make it as simple as possible for them. Even last year, an onboarding chatbot that asked you a few questions was amazing. You typed, it answered. Today that's not enough. People don't want to type, they want to tap. So now we build MCP apps and widgets to make the journey more engaging.

There are usually two ways to do that. One: the AI writes HTML or a React component, and you render it inline. Very flexible, but your browser runs code the AI wrote. Two: you design and build the widgets yourself, in advance. Safe, and it looks like your app, but it can only show what someone planned months ago.

The trend is shifting now. What if you didn't have to build every screen? What if the screen adapted to what the user needs, right now? That's generative UI. And Google started an open answer to it: A2UI.

### 1:15 · How A2UI works
[Point at the bricks panel.]

Here's how A2UI works. My app has a fixed set of components. I call them bricks: cards, buttons, lists, a seat map, a chart. The AI doesn't write any code. It sends JSON. The JSON says which bricks to use, where they go, and what data goes in them. The app reads the JSON and draws the bricks with its own code. If the AI asks for a brick that isn't in the set, the app doesn't draw it. So the AI only sends data, never code.

## Part 2 · What I tried

### 1:45 · Dinner
Let me try it. This meetup ends soon, and I'm hungry.

[Hold Space] **Say to the app: "I want dinner after this event. Pick a place nearby."**

Watch the right side. While I speak, a small model guesses the bricks; those are the outlines. While the screen builds, the real picks fill in. And these places are real. It searched the web just now.

[Tap a place] I tap one, and it asks only what it needs: what time, and how many people.

### 2:20 · The decision model
Now my friends text me.

[Hold Space] **Say to the app: "We're six, and later."**

Six people, one hour later. Same screen, changed in place, in about 0.2 seconds.

[Point at the turn line: "decision model" and the cost at its end]
No big AI model was called for that. Look at the cost: less than a tenth of a cent. The screen before it cost about one to three cents. Here's why it matters. The big model takes three to five seconds to build a screen, and every call costs money. But most of what we do in an app is small changes: one more person, a later time. So a small decision model answers one question first: is this a small change, or something new? A small change goes straight into the screen. Something new goes to the big model. In my tests, it sent 30 out of 30 sentences the right way.

### 3:05 · A screen nobody designed *(cut this part first if you're running long)*
[Click **New session**] Tomorrow I fly.

[Hold Space] **Say to the app: "I need to book a flight tomorrow."**

It already knows the date and that I'm in Bremen. It only asks what it doesn't know.

[Hold Space] **Say to the app: "To New York, give me options."**

[Tap a flight] Flights have seats, so it gives me a seat map. Nobody designed this screen.

## Part 3 · The difference

### 3:45 · Widgets, HTML, A2UI
Now the two old ways, with the same requests.

[Press **1**: Widgets]
[Hold Space] **Say to the app: "I need a flight from Bremen to New York tomorrow."**

Looks good. Now a seat.

[Hold Space] **Say to the app: "Pick me a window seat."**

Just text. Nobody built a seat map widget, so it can't show one. Safe, but stuck.

[Press **2**: HTML] Now the AI writes the page itself.

[Hold Space] **Say to the app: "Make the page pink and add a login box."**

It did it, from one sentence. The AI wrote code, and my browser ran it. I keep it in a sandbox here, but the code still runs. Now imagine a web page secretly tells the AI to do this. A fake login box could ask for your password and send it anywhere.

[Press **3**: A2UI] Same sentence.

[Hold Space] **Say to the app: "Make the page pink and add a login box."**

Not available. It said no because I told it to. But even if it tried, no brick can change colors, nothing it sends can run, and a tap only comes back to my app.

### 4:30 · Advantages and close
[Open **Under the hood → JSON stream**]

This is everything the AI sent. Just data: a heading, a list, a seat map. Nothing in here can run.

So what do you get? It looks like your app, because it uses your own components. It's safe by design, because the AI sends data, not code. It can build screens nobody designed. And it's not only for the web: A2UI has renderers for React, Flutter, Angular and SwiftUI. The one limit is that the AI can only use the bricks in the box. Ask for something outside it, and it says "not available." I think that's a feature, because the safety lives in the box.

One honest downside: every new screen costs money. [Point at COST in the counters at the bottom right.] That's tonight's total so far. One to three cents a screen sounds small. But at 10,000 users with 20 screens a day, that's about $3,000 a day. So you want the big model only when something is really new.

And the decision model makes it fast and cheap. Tonight that was **N** out of **M** turns with no big AI call. [Read N and M from the counters at the bottom right: LLM CALLS AVOIDED and TURNS.]

Generative UI is the future. A decision model makes it work. Thank you.

---

## If something goes wrong

Stay calm. It's a live demo, and the room is on your side.

| What happens | What you do | What you can say |
|---|---|---|
| The mic doesn't pick you up | Click "Or type a request", type the same line, Enter | "The mic is shy tonight, I'll type." |
| A turn hangs for more than ~10 s | Press the F-key for that step (table below) | "Here's the run from this afternoon. Same events, same timing." |
| Wi-Fi or the API is down | Use F1–F6 for the whole story; they work offline | "The network left the party. Here's the recording of the real run." |
| Someone asks for something odd | Let it build; a "Not available" card is a good answer too | "That's outside the box, and it tells you so." |
| A list says "Nothing found" | Move on, or press the F-key | "The web had nothing for that one. It doesn't invent things." |
| You used F-key replays | Replays never add to COST, and F1, F3, F5 show no cost: don't point at the cost | "A new screen costs one to three cents; a small edit, a tiny fraction of that." |

**Replay keys** (work without Wi-Fi):
| Key | Step |
|---|---|
| F1 | "I want dinner after this event…" (opens a fresh session by itself) |
| F2 | Tap a place → time + guests |
| F3 | "We're six, and later." (the decision model) |
| F4 | "I need to book a flight tomorrow." (opens a fresh session by itself) |
| F5 | "To New York, give me options." |
| F6 | Tap a flight → seat map |

Replays don't change the turn counters or the Cost total, so N of M and the cost stay honest. If you replayed most of the demo, say "tonight's live turns" or skip the numbers.

**Cost meter:** each turn line ends with what that turn cost: measured tokens × list price, plus $0.01 per web search. A decision-model edit shows **<$0.001**. COST in the counters is the total for this visit. Not counted: speech to text and the brick guesses. On the live site a new screen cost $0.008–0.029 (cheaper once the prompt is cached).

---

## Rehearsal checklist
1. Run the script twice out loud with the mic and a timer. Aim for 5:00. If you're over, cut "A screen nobody designed" first.
2. Say the "Say to the app" lines exactly as written. Short sentences work best for the mic and the AI.
3. Practise the key moments: the bricks outlined while you speak and filled while it builds, pointing at "decision model" on the turn line, and the login box in HTML vs A2UI.
4. Try F1–F6 once with Wi-Fi off.
5. Before going on: Delete all sessions, A2UI mode, decision model on.
6. Weather ("Will it rain?") is merged but use it on stage only after it's deployed and you've tried it once.
