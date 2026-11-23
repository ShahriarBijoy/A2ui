# Smoke results (step 13)

- Target: https://brick-box.shahriarbijoy.workers.dev
- Run: 24 Nov 2026, 00:05 to 24 Nov 2026, 00:09 (Europe/Berlin), from a dev machine in Germany; times are client-observed from request start.
- Script tree: b273b7a. Models reported by the Worker: claude-sonnet-5-5, claude-haiku-5-5.
- Note: production, deployed 615d559 (composer claude-sonnet-5-5), real clock ~00:05 Tue 24 Nov: dinner results reflect late-night closing; re-run 18:30-19:30 before the talk
- a2ui: every scenario (all steps) and five held-out lines, 3× each, decision model on. widgets and html: each scenario's opening line once, in the modes it lists.
- Pass: at least one component rendered (widgets: a widget or text; html: a page); 0 refused and 0 validation errors in the real client processor; ≤ 7 visible blocks; no error; patchOnly steps: route decision patch and no usage event.
- Visible block (controller ruling): a top-level visual unit inside the root container. The root is unwrapped through Cards, single-child Columns and the first tab; each child of the main Column counts once, whatever it holds (a label/value Row, a List, a nested Column or Card, a Button).
- first UI: the turn's surface has a root (patch steps: the first knob change). screen done: last composer or knob line, caption, widget or html. data arrived: last live data event. Search ms is the Worker's own measure (the longest search of the turn); records are summed over the turn's searches.
- Medians with (min–max). "–" means not measured. "expect" counts the scenario's expected bricks/data (informational, not part of pass).

**52/62 lines pass.**

- Main scenarios (dinner, flight): 4/6 scenario runs pass (67%; target 100%)
- Wildcards (bill, packing, quiz): 7/9 scenario runs pass (78%; target ≥ 80%)
- Contrast (pink): 3/3 scenario runs pass (100%; target –)
- Held-out lines: 13/15 scenario runs pass (87%; target –)

| mode | line | pass | first UI | screen done | data arrived | output tokens | search ms | records | blocks | notes |
|---|---|---|---|---|---|---|---|---|---|---|
| a2ui | dinner #1 "I want dinner after this event, pick a place nearby." | 3/3 | 2.00 s (1.65 s–2.04 s) | 3.68 s (3.54 s–3.97 s) | 5.08 s (5.08 s–5.71 s) | 596 (586–706) | 2916 (2555–3146) | 0, 3, 0 | 3 (3–3) | expect 3/3 |
| a2ui | dinner #2 tap pick_* | 1/3 | 1.96 s | 4.56 s | – | 844 | – | – | 6 | expect 1/1; no OptionCard/Button action starting with "pick_" on the newest surface; tapped pick_restaurant |
| a2ui | dinner #3 "We're six, and later." | 1/3 | 219 ms | 220 ms | – | – | – | – | 6 | 2 not run (an earlier step failed); step 2 had no tap target |
| a2ui | dinner #4 tap confirm_* | 1/3 | 2.13 s | 3.04 s | – | 361 | – | – | 4 | 2 not run (an earlier step failed); step 2 had no tap target; tapped confirm_table |
| a2ui | flight #1 "I need to book a flight tomorrow." | 3/3 | 1.90 s (1.48 s–2.17 s) | 4.00 s (3.83 s–4.57 s) | – | 700 (698–756) | – | – | 5 (5–5) | expect 3/3 |
| a2ui | flight #2 "To New York, give me options." | 3/3 | 2.35 s (1.92 s–2.57 s) | 4.96 s (3.84 s–5.17 s) | 2.55 s (2.17 s–2.81 s) | 893 (689–900) | – | – | 4 (3–4) | expect 3/3; demo flights: 4 |
| a2ui | flight #3 tap pick_* | 3/3 | 1.77 s (1.72 s–2.12 s) | 4.25 s (4.02 s–4.41 s) | – | 723 (686–759) | – | – | 4 (4–5) | expect 3/3; tapped pick_flight |
| a2ui | flight #4 tap confirm_* | 3/3 | 2.26 s (1.43 s–2.65 s) | 3.60 s (2.35 s–3.82 s) | – | 405 (403–514) | – | – | 5 (5–5) | tapped confirm_flight |
| a2ui | bill #1 "Split a 120 euro bill between four, Jonas only had drinks." | 3/3 | 1.39 s (1.33 s–1.71 s) | 3.85 s (3.83 s–4.13 s) | – | 726 (717–726) | – | – | 5 (5–5) |  |
| a2ui | packing #1 "Packing list for New York in November." | 2/3 | 1.93 s (1.76 s–2.03 s) | 6.43 s (5.61 s–6.75 s) | – | 1242 (1059–1295) | – | – | 5 (5–9) | 9 visible blocks |
| a2ui | quiz #1 "Quiz me on five German A1 words." | 2/3 | 1.71 s (1.53 s–1.90 s) | 4.32 s (4.12 s–6.15 s) | – | 760 (731–1194) | – | – | 6 (5–8) | 8 visible blocks |
| a2ui | pink #1 "Make the page pink and add a login box." | 3/3 | 1.62 s (1.57 s–1.70 s) | 2.40 s (2.33 s–2.92 s) | – | 378 (372–385) | – | – | 3 (3–3) |  |
| a2ui | lisbon #1 "Plan a 3-day trip to Lisbon in March." | 3/3 | 1.75 s (1.39 s–2.01 s) | 4.61 s (4.41 s–5.25 s) | 4.35 s | 851 (792–1017) | 2253 | –, 1, – | 6 (5–6) |  |
| a2ui | phones #1 "Compare two phone plans for me." | 2/3 | 1.82 s (1.78 s–2.02 s) | 6.72 s (6.34 s–7.67 s) | – | 1295 (1197–1553) | – | – | 6 (4–9) | 9 visible blocks |
| a2ui | dog #1 "I want to adopt a dog. What do I need?" | 2/3 | 1.91 s (1.68 s–2.13 s) | 5.54 s (5.26 s–6.02 s) | – | 967 (919–1093) | – | – | 7 (4–9) | 9 visible blocks |
| a2ui | gift #1 "Find a gift for my mum, around 50 euros." | 3/3 | 1.89 s (1.81 s–2.06 s) | 4.09 s (3.95 s–4.09 s) | 6.50 s (5.49 s–6.93 s) | 700 (682–703) | 4182 (3118–4501) | 5, 2, 5 | 3 (3–3) |  |
| a2ui | haircut #1 "Book a haircut for Saturday morning." | 3/3 | 2.03 s (1.66 s–2.09 s) | 4.87 s (4.37 s–4.89 s) | – | 859 (793–915) | – | – | 5 (5–5) |  |
| widgets | dinner #1 "I want dinner after this event, pick a place nearby." | 1/1 | 4.09 s | 4.09 s | 4.09 s | 47 | 3182 | 5 | – | widget RestaurantWidget |
| widgets | flight #1 "I need to book a flight tomorrow." | 1/1 | 822 ms | 822 ms | – | 101 | – | – | – | widget FlightSearchWidget |
| widgets | bill #1 "Split a 120 euro bill between four, Jonas only had drinks." | 1/1 | 2.02 s | 2.02 s | – | 268 | – | – | – | text answer |
| widgets | packing #1 "Packing list for New York in November." | 1/1 | 2.40 s | 2.40 s | – | 359 | – | – | – | text answer |
| widgets | quiz #1 "Quiz me on five German A1 words." | 1/1 | 1.06 s | 1.06 s | – | 105 | – | – | – | text answer |
| html | dinner #1 "I want dinner after this event, pick a place nearby." | 1/1 | 619 ms | 5.07 s | – | 1431 | – | – | – |  |
| html | flight #1 "I need to book a flight tomorrow." | 1/1 | 510 ms | 5.35 s | – | 1534 | – | – | – |  |
| html | bill #1 "Split a 120 euro bill between four, Jonas only had drinks." | 1/1 | 448 ms | 5.36 s | – | 1459 | – | – | – |  |
| html | packing #1 "Packing list for New York in November." | 1/1 | 456 ms | 7.53 s | – | 2034 | – | – | – |  |
| html | quiz #1 "Quiz me on five German A1 words." | 1/1 | 578 ms | 5.89 s | – | 1741 | – | – | – |  |
| html | pink #1 "Make the page pink and add a login box." | 1/1 | 478 ms | 2.79 s | – | 739 | – | – | – |  |
