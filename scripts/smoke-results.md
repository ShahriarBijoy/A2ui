# Smoke results (step 13)

- Target: https://brick-box.shahriarbijoy.workers.dev
- Run: 23 Nov 2026, 22:36 to 23 Nov 2026, 22:38 (Europe/Berlin), from a dev machine in Germany; times are client-observed from request start.
- Script tree: 4f7da0e. Models reported by the Worker: claude-haiku-5-5.
- Note: The deployed Worker predates the step-13 prompt change (time context in search queries); its worker code equals fb43969.
- a2ui: every scenario (all steps) and five held-out lines, 3× each, decision model on. widgets and html: each scenario's opening line once, in the modes it lists.
- Pass: at least one component rendered (widgets: a widget or text; html: a page); 0 refused and 0 validation errors in the real client processor; ≤ 7 visible blocks; no error; patchOnly steps: route decision patch and no usage event.
- Visible block: a component reachable from root in render order, except layout containers (Card, Column, Row, Tabs; first tab only). A List is one block, a Button one, a refused placeholder one.
- first UI: the turn's surface has a root (patch steps: the first knob change). screen done: last composer or knob line, caption, widget or html. data arrived: last live data event. Search ms is the Worker's own measure (the longest search of the turn); records are summed over the turn's searches.
- Medians with (min–max). "–" means not measured. "expect" counts the scenario's expected bricks/data (informational, not part of pass).

**53/62 lines pass.**

- Main scenarios (dinner, flight): 1/6 scenario runs pass (17%; target 100%)
- Wildcards (bill, packing, quiz): 9/9 scenario runs pass (100%; target ≥ 80%)
- Contrast (pink): 3/3 scenario runs pass (100%; target –)
- Held-out lines: 14/15 scenario runs pass (93%; target –)

| mode | line | pass | first UI | screen done | data arrived | output tokens | search ms | records | blocks | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| a2ui | dinner #1 "I want dinner after this event, pick a place nearby." | 3/3 | 1.08 s (974 ms–1.19 s) | 2.24 s (2.07 s–2.31 s) | 4.70 s (4.30 s–5.18 s) | 546 (545–560) | 3195 (2959–3910) | 2, 2, 3 | 2 (2–2) | expect 3/3 |
| a2ui | dinner #2 tap pick_* | 3/3 | 1.25 s (1.10 s–1.85 s) | 2.11 s (2.07 s–2.42 s) | – | 559 (539–653) | – | – | 5 (4–6) | expect 0/3; tapped pick_restaurant; expected bricks missing: ChoicePicker |
| a2ui | dinner #3 "We're six, and later." | 1/3 | 783 ms (176 ms–825 ms) | 1.06 s (176 ms–1.09 s) | – | 137 (135–139) | – | – | 5 (4–6) | route compose (partial edit: Time), expected patch; LLM was called (usage event) |
| a2ui | dinner #4 tap confirm_* | 3/3 | 1.47 s (988 ms–1.50 s) | 1.58 s (1.55 s–1.67 s) | – | 366 (349–417) | – | – | 5 (5–5) | tapped confirm_dinner |
| a2ui | flight #1 "I need to book a flight tomorrow." | 3/3 | 2.12 s (2.06 s–2.13 s) | 2.38 s (2.35 s–2.46 s) | – | 652 (647–653) | – | – | 5 (5–5) | expect 3/3 |
| a2ui | flight #2 "To New York, give me options." | 3/3 | 903 ms (846 ms–951 ms) | 1.27 s (1.23 s–1.98 s) | 1.23 s (1.18 s–1.27 s) | 130 (123–479) | – | – | 5 (5–5) | expect 1/3; demo flights: 4; expected bricks missing: OptionCard; not reachable from root: list, flight |
| a2ui | flight #3 tap pick_* | 0/3 | – | – | – | – | – | – | – | no OptionCard/Button action starting with "pick_" on the newest surface |
| a2ui | flight #4 tap confirm_* | 0/3 | – | – | – | – | – | – | – | 3 not run (an earlier step failed); step 3 had no tap target |
| a2ui | bill #1 "Split a 120 euro bill between four, Jonas only had drinks." | 3/3 | 1.06 s (986 ms–1.24 s) | 2.24 s (2.19 s–2.57 s) | – | 641 (608–656) | – | – | 5 (5–5) |  |
| a2ui | packing #1 "Packing list for New York in November." | 3/3 | 1.11 s (993 ms–1.12 s) | 2.78 s (2.58 s–3.33 s) | – | 781 (654–947) | – | – | 5 (5–6) |  |
| a2ui | quiz #1 "Quiz me on five German A1 words." | 3/3 | 1.07 s (1.01 s–1.17 s) | 2.46 s (2.31 s–2.83 s) | – | 685 (581–736) | – | – | 4 (4–4) |  |
| a2ui | pink #1 "Make the page pink and add a login box." | 3/3 | 1.29 s (1.27 s–1.38 s) | 1.41 s (1.34 s–1.50 s) | – | 263 (262–273) | – | – | 2 (2–2) |  |
| a2ui | lisbon #1 "Plan a 3-day trip to Lisbon in March." | 3/3 | 1.38 s (1.23 s–1.46 s) | 2.98 s (2.97 s–3.60 s) | – | 822 (793–956) | – | – | 5 (5–6) |  |
| a2ui | phones #1 "Compare two phone plans for me." | 2/3 | 1.05 s (1.05 s–1.93 s) | 2.32 s (2.16 s–2.76 s) | – | 627 (601–757) | – | – | 4 (4–5) | 1 refused; 1 validation errors (error /components/5/@checks · Button needs @checks); not reachable from root: compare_label |
| a2ui | dog #1 "I want to adopt a dog. What do I need?" | 3/3 | 2.30 s (2.24 s–2.73 s) | 2.54 s (2.50 s–2.99 s) | – | 602 (593–640) | – | – | 4 (4–6) |  |
| a2ui | gift #1 "Find a gift for my mum, around 50 euros." | 3/3 | 1.16 s (1.07 s–1.89 s) | 2.30 s (2.17 s–2.44 s) | – | 624 (585–645) | – | – | 4 (4–4) |  |
| a2ui | haircut #1 "Book a haircut for Saturday morning." | 3/3 | 1.12 s (1.09 s–1.18 s) | 2.64 s (2.51 s–2.65 s) | – | 726 (676–746) | – | – | 5 (4–5) |  |
| widgets | dinner #1 "I want dinner after this event, pick a place nearby." | 1/1 | 4.53 s | 4.53 s | 4.53 s | 113 | 3336 | 5 | – | widget RestaurantWidget |
| widgets | flight #1 "I need to book a flight tomorrow." | 1/1 | 1.14 s | 1.14 s | – | 117 | – | – | – | widget FlightSearchWidget |
| widgets | bill #1 "Split a 120 euro bill between four, Jonas only had drinks." | 1/1 | 1.97 s | 1.97 s | – | 256 | – | – | – | text answer |
| widgets | packing #1 "Packing list for New York in November." | 1/1 | 2.82 s | 2.82 s | – | 435 | – | – | – | text answer |
| widgets | quiz #1 "Quiz me on five German A1 words." | 1/1 | 1.23 s | 1.23 s | – | 102 | – | – | – | text answer |
| html | dinner #1 "I want dinner after this event, pick a place nearby." | 1/1 | 715 ms | 5.19 s | – | 1430 | – | – | – |  |
| html | flight #1 "I need to book a flight tomorrow." | 1/1 | 512 ms | 4.33 s | – | 1248 | – | – | – |  |
| html | bill #1 "Split a 120 euro bill between four, Jonas only had drinks." | 1/1 | 671 ms | 4.42 s | – | 1227 | – | – | – |  |
| html | packing #1 "Packing list for New York in November." | 1/1 | 593 ms | 7.28 s | – | 2052 | – | – | – |  |
| html | quiz #1 "Quiz me on five German A1 words." | 1/1 | 471 ms | 5.56 s | – | 1701 | – | – | – |  |
| html | pink #1 "Make the page pink and add a login box." | 1/1 | 677 ms | 2.72 s | – | 714 | – | – | – |  |
