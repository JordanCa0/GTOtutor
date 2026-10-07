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
