# Future ideas

Features we want later, not scheduled yet. Each has notes from earlier design discussions so the thinking isn't lost.

## Opponent archetypes

Villains that play like recognisable player types (nit, tight-aggressive, loose-aggressive, calling station, maniac, …) instead of everyone playing the solved charts. The AI that drives these players is referred to as "JEV AI".

- **Preflop.** Build each archetype's ranges from the solved charts, not from scratch:
  - Widen or narrow every range along the solved hand ranking.
  - Shift the raise/call mix (e.g. more calling for a station, more 3-betting for a LAG).
  - Archetype ranges are definitions ("a nit opens 12% from UTG"), so hand-written ones are fine. Only GTO charts need a solver behind them.
- **Postflop is the hard part.** A flop solve given an archetype's ranges plays the *best* strategy for those ranges, so a loose player would still play well after the flop. Real archetype habits (calling too much, never bluffing) need extra modelling, for example:
  - locking the villain's strategy in the solver
  - adjusting solved frequencies with rules
- **Grading hero against an archetype.** Use a best response to the archetype's ranges, which the preflop solver can already compute, instead of the GTO charts.
- **Compute cost.** Every archetype matchup changes the ranges reaching the flop, so flop solves multiply:
  - Solving every flop for one spot is about 10 hours on the desktop.
  - Only solve archetype flops for the most common matchups (e.g. a loose BB defending vs a BTN open).
  - Elsewhere, borrow the baseline flop solves and have the coach say so.

## Heads-up exploit mode

Play heads-up against one archetype for a session, then write notes on how to exploit them in specific spots.

- **Notes:** the player writes notes during or after the session ("folds too much to 3-bets", "never bluffs the river"). The coach checks them against the archetype's actual tendencies and against the EV of exploiting them.
- **Spot-based drills:** deal the spots where that archetype leaks most, and show the exploitative play next to the GTO play with the EV difference.
- **Needs:**
  - heads-up charts and spots (the current charts are 6-max only)
  - saved notes per player (fits the planned stars/tags in `docs/accounts-and-data.md`)

## Player profiling and the style chart

Work out a player's archetype from their own hands and place them on a 2-D chart: loose ↔ tight (how many hands they play) against passive ↔ aggressive (how often they bet and raise rather than call).

**First version built (2026-10-09)**, on the profile page:
- **Placement:** one dot for all the player's decisions plus one per spot type, against the charts' own frequencies, so the centre is GTO play. It has a 95% range cross rather than an ellipse.
- **Code:** `apps/api/src/teacher/playerStyle.ts` and `apps/web/src/components/StyleChart.tsx`.
- **Still ideas:** the named stats below, drift over time, archetype labels, and professional comparisons.

- **Stats we already have the data for** (every decision is saved):
  - VPIP: voluntarily put money in the pot
  - PFR: preflop raise
  - 3-bet %
  - fold to 3-bet
  - flop aggression
- **Placement:** show a confidence ellipse rather than a single dot until there are enough hands.
- **Drift over time:** show how the player moves on the chart from session to session, and against GTO's position on the same axes.
- **Feed the coach:** e.g. "you're playing 8 points looser than the charts from early position".

## Professional player comparisons

Show which well-known professionals have a similar style on the same chart.

- Needs a source of public stats for named players, and permission to use it. Licensing and the right to use names need checking before building this.
- A safer first version compares against anonymous style profiles ("typical online reg", "typical live pro") rather than named people.

## Glossary and beginner section

A glossary of the poker and solver terms the app uses, plus a beginner path for players new to poker strategy.

- **Glossary:** short plain-language definitions. Examples:
  - positions (UTG … BB), open, 3-bet, 4-bet, limp, iso-raise
  - range, combo, equity, realization, EV, bb/hand
  - GTO, mixed strategy, exploitability
  - stat names such as VPIP and PFR
- **Linked from where terms appear:** hover or tap a term in the verdict, chart, coach answers or settings to see its definition. The coach can link glossary entries in its answers.
- **Beginner path:** a short guided sequence. It starts with what positions and ranges are and why position matters, then moves to easy spots (clear opens and folds) before mixed and close decisions.
- **Beginner mode:** optionally simpler verdicts (e.g. "good / OK / mistake" without EV numbers) and a coach told to avoid jargon or define it inline.

## Hand replayer

Recreate a hand, from a real game or a hypothetical one, and have it solved and explained.

- **Two ways in:**
  - **Describe it to the coach:** "I was on the button with AJs, CO opened 2.5, I 3-bet to 7.5…". Claude turns the description into a structured hand: seats, stacks, hole cards, board and the action on each street. The coach already uses structured output (`apps/api/src/teacher/llmTeacher.ts`).
  - **Build it in settings:** pick positions, stacks, cards, board and actions directly. This is also where a described hand opens for checking and correcting, so a misunderstood description never gets solved as-is.
- **Replay:** step through the hand street by street in the normal table view, with the solver's strategy and the coach's explanation at each of hero's decisions.
- **What "solved" can mean today:**
  - Preflop decisions come from the solved charts.
  - Flop decisions use the stored flop solves when the hand matches a solved spot: same preflop line, 100bb, standard sizes. Other flops borrow the nearest solved flop, as in play.
- **What needs new solving:** custom stack depths, bet sizes, preflop lines outside the charts, and turn and river.
  - The flop solver is AGPL and can't run on the live server.
  - So this depends on the planned browser (WASM) solving in `docs/postflop-plan.md`, or on a solver we write ourselves.
  - Until then, the replayer should say clearly which decisions are solved, approximated or unsolved.
- **Saving:** replayed hands could live with saved hands ("My hands" in `docs/accounts-and-data.md`) and be shared by link.

## Mobile layout

Make the app work properly on phones. Found 2026-10-08 while building the chart explorer.

- **The page is wider than a phone screen,** so it scrolls sideways and the header gets cut off at 390px wide.
- **The enlarged range chart opens partly off-screen to the right.** The pop-up lines up with the too-wide page instead of the screen. This matters most for the chart explorer, where tapping hands is the main use.
- Check every screen at phone width on a real device: title, setup, table, decision panel, coach, session review, dialogs. The `mobile-native` skill's checklist covers the usual fixes: tap highlight, `100dvh`, inputs that zoom the page, safe areas.
