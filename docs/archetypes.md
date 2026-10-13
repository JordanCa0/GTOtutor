# Opponent archetypes (JEV AI)

Opponents can play as a player type instead of the charts: fish, nit, loose-aggressive (LAG) or
tight-aggressive (TAG), or a random mix of them. Setup → Player types. Each opponent's type shows
as a small tag on its seat, and the seat's tooltip says how the type plays and how to play against
it. First version: 2026-10-13.

## How it works

- **JEV AI** is TypeSafe's Jev model (`POST https://api.typesafe.ai/v1/systemone`; docs at
  `https://docs.typesafe.ai`). It answers "choice" questions with a probability per option, which
  works as a mixed strategy. The client (`apps/api/src/archetypes/jevClient.ts`) retries 429 and
  529 answers with backoff while its time allows.
- Opponents only ever choose among the chart or solver node's legal actions, so the game tree, the
  bet sizes and hero's grading are unchanged.

## Before the flop: premade archetype charts

**Play never calls Jev before the flop.** Each archetype's preflop play is a lookup in a premade
chart file, built once by asking Jev:

- `npx tsx apps/api/scripts/buildArchetypeCharts.ts --charts preflop/charts/preflop-v9.json`
  (needs `JEV_API_KEY` in `apps/api/.env`) writes `preflop/charts/archetypes/preflop-v9.json`.
  - It asks about every 100bb chart node, for each archetype: all 169 hand classes, 13 per request.
    About 13,200 requests for `preflop-v9` (254 nodes × 4 types × 13), 3 at a time.
  - The state describes the spot and the player type. Each question gives the hand and its chart
    frequencies; the options are the node's legal actions.
  - It saves as it goes, so a stopped build resumes. Hands a failed request missed are asked again
    on the next run.
  - `--archetypes fish,nit` builds only some types; `--profile` another stack profile.
- The "|nocall" nodes the charts derive (someone already called, so no overcall) reuse their base
  node's answers the same way the charts do: the call becomes a fold.
- **Code sets how many hands, Jev picks which** (`calibrated` in `archetypeService.ts`). Asked alone,
  Jev gets the order of hands and the way each type plays them right, but not the width: its fish
  played ~85% of hands from every seat, its LAG opened 52% UTG. So:
  - The width at each node is the rules' (below): the share of combos the type plays there.
  - Each hand's place is Jev's play log-odds plus the rules', each capped at 1-99%, so Jev's clear
    preferences decide and the rules order the hands Jev is near-certain about alike.
  - The hands are shifted in log-odds until they play that width. Jev's mix of raising, calling
    and limping is kept.
  - Widths at 100bb, `preflop-v9` (% of combos played): UTG open chart 20, fish 38, nit 10, LAG 31,
    TAG 18; BTN open 41, 52, 21, 48, 37; BB vs BTN open 55, 62, 27, 59, 49.
- The result is blended: 80% Jev, 20% the rule baseline (`JEV_WEIGHT`), which smooths out odd answers.
- The file is tied to its charts and to `ARCHETYPE_DEFS_VERSION` (`archetypes.ts`). The server
  ignores a file built for other charts or definitions and logs it. Bump that version, and rebuild,
  when a definition changes.
- The server loads `preflop/charts/archetypes/<100bb charts version>.json` (override with
  `ARCHETYPE_CHARTS`). The startup log says how many spots it covers.
  - With a stack manifest, that's the version of its 100bb chart file: `stacks-v1` runs
    `preflop-v9` at 100bb, so it uses `archetypes/preflop-v9.json`.
- **Rules** (`apps/api/src/archetypes/archetypes.ts`) play every spot the file doesn't cover (no file
  yet, other stack depths, the placeholder charts) and are the baseline of the blend:
  - They start from the chart's own frequencies.
  - Looser types add hands, stronger first by the Chen formula. Tighter types keep the strongest
    `looseness` share of the chart's combos at each spot (a nit half, a TAG 90%), so they still
    open wider on the button than under the gun.
  - Then the mix between calling and raising shifts by the type's aggression.

## After the flop

With a key, JEV AI makes every postflop decision for an archetype opponent, on the flop, turn and river.
- **What Jev sees** (`apps/api/src/archetypes/postflopQuestion.ts`):
  - the board, the opponent's cards, and a plain read of its hand (`handReading.ts`: "top pair, queen kicker", "flush draw", "the board plays")
  - its position, the pot, the amount to call and the stack behind
  - every action so far, street by street, and the player type's postflop habits
- **What it doesn't see:** the solver's frequencies. The decision is Jev's own, and its probabilities are sampled as is (no blend).
- **The options** are the solver node's legal actions (check, the 33/66/100% bets, call, raise, fold), so the tree, the bet sizes and hero's grading still line up.
- **How it runs:**
  - When an archetype opponent is to act postflop, the engine pauses (`awaitingVillain`).
  - `HandService.playVillains` asks Jev, hands the answer to `applyVillainChoice`, and play continues.
  - This happens inside the decide request, and after a live turn solve arrives.
  - If Jev fails or takes more than 6 s, that one decision plays the solver strategy.
- **Turn and river** still need the live solver for hero's options and grading.
  - Opponent hands Jev plays off the solver's path stay in the turn solve: `SEAT_HAND_FLOOR` in `liveSolve.ts` keeps both seated hands in range.
- **Without a key**, archetypes play the solver after the flop, as before.
- **The action log** marks each of their postflop actions with `decidedBy` (`jev`, `solver`, or `rules` in free play) and `jevMs`, visible in the hand's API response (the browser's network tab), not in the UI.

### Free play: pots with no solver data

Some heads-up pots have no solved flops: limped pots outside the SB (the charts rarely limp there, so they were never solved, but fish limp all the time), a flop shape with no solved example, or a hand outside the solved ranges. With an archetype opponent and a key, those pots are played out instead of running out (`apps/api/src/engine/freePlay.ts`):
- **The tree:** the solved games' sizes: 33/66/100% of the pot on the flop, 33/75/125% on the turn, 50/100% and all-in on the river; one 3x raise per street, then call or fold; a bet that would reach the effective stack becomes all-in.
- **The opponent:** JEV AI on every street, with the same question as above. If Jev fails or is too slow, a simple rule plays: check when free, call with a pair or a draw before the river, otherwise fold.
- **Turn and river** are dealt straight away: no live solve.
- **Hero isn't graded** after the flop: no verdict, no hint, nothing for streaks, stats or the coach. `HandService.submit` answers with `feedback: null`, and the table says why (`HandView.freePlay`).
- **Without a key**, or against opponents without a type, these pots run out as before.

Measured on the 100bb charts (2026-10-13, hero still in after preflop): against fish, 36% of hands were unsolved limped or iso pots that ran out; mixed tables, 14%.

## The coach

The coach is told each opponent's type while it is still in the hand (`opponentTypesLine` in
`llmTeacher.ts`). Explanations and chat answers add one "Exploit:" point when the type changes the
best practical play; hints get the types but never the exploit. The grade itself stays against the
charts and the solver. Cached explanations are kept apart for chart and archetype opponents.

## Setup

- `JEV_API_KEY` in `apps/api/.env`. Without it, archetypes play the solver after the flop (the
  startup log says so); preflop they use the premade charts either way.
- Optional: `JEV_MODEL` (default `jev-latest`), `JEV_API_URL`, `ARCHETYPE_CHARTS`.
- Production: `/gtotutor/JEV_API_KEY` in SSM (see `docs/deployment.md`). The archetype charts ship
  in the image (`COPY preflop/charts/archetypes`).

## Limits of this version

- **Pots with no solver data** (mostly limped pots outside the SB) are played out in free play, ungraded (see above). Solving those spots with the archetypes' ranges would let them be graded.
- **Each postflop decision is a live Jev call**, so the opponent's reply takes as long as Jev does.
  - While it waits after a live solve, the table shows "Solving the turn…".
  - The speculative turn solves started while hero decides on the flop still guess the solver's reply, so they miss more often against Jev.
- **Only 100bb has premade charts.** 20bb, 60bb and mixed-stack tables play the rules preflop
  (Jev still plays them postflop). The server reads only the 100bb file, so charts for other
  depths would need it to load one file per profile first.
- **Hero is still graded against the charts.** A best response to the archetype's ranges would be
  the right grade (see `docs/future-ideas.md`).
- With Simple pots on, or with a chosen opponent, those rules still apply on top of the archetypes.
  - For example, everyone but the chosen opponent folds.
