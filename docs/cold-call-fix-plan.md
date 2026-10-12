# Plan: premium hands flat too often in position (100bb charts)

**Status (2026-10-11): planned, not started.** A stopgap shipped first: preflop, an option within 0.3bb of the best EV grades as "Fine. A close call." instead of a mistake (`PREFLOP_CLOSE_EV_BB` in `handEngine.ts`).

## The problem

In `preflop-v9`, hands that should mostly 3-bet often just call an open in position from the HJ or CO:

| Spot | KK 3-bets | QQ 3-bets | JJ 3-bets | AKo 3-bets |
|---|---|---|---|---|
| HJ vs UTG | 47% | 20% | 19% | 0% |
| CO vs UTG | 100% | 5% | 0% | 11% |
| CO vs HJ | 92% | 9% | 0% | 28% |

The order is inconsistent too: TT 3-bets 99% in HJ vs UTG while QQ 3-bets 20%. From the BTN and the blinds, QQ 3-bets 97–100%, as it should. A full solver 3-bets KK, QQ and AK nearly always in these spots.

The model sees calling and 3-betting as nearly equal here (a few tenths of a bb apart), so CFR settles anywhere between them.

## Why

1. **Calling is protected from multiway pots.** Every pot stays heads-up, so once someone calls, the players behind can only 3-bet (squeeze) or fold. A real HJ flat with QQ often faces the BTN or the blinds calling too, which costs a lot of its value. Our tree never charges for that.
2. **3-betting looks costly at 100bb.** Early-position 4-bet ranges are strong, and QQ facing a 4-bet to 22 mostly calls at a loss.

At 60bb, the smaller 4-bet (20) makes cause 2 weaker, and QQ 3-bets 100% in most of these spots (63% HJ vs UTG). Cause 1 is the same at every depth, though.

## Fix

A **cold-call penalty**: a caller with players still to act behind gets lower realization, standing in for the multiway pots and extra squeezes the tree leaves out.

- In `preflop/src/realization.rs`, scale realization at flop leaves for a player who cold-called (not the raiser, not the BB closing the action) by a factor per player left to act behind at the time of the call, for example 0.97 per player.
- The factor is a model choice, not a measurement: our flop solves are all heads-up, so calibration can't learn it. Tune it so a known reference matches:
  - KK, QQ and AK 3-bet almost always from the HJ and CO against UTG and HJ opens;
  - JJ and TT mix;
  - the BTN and blinds barely change.
- The BB closing the action and the BTN have nobody behind (the BTN has only the blinds), so they change least.

## Cost

| Step | What | Compute |
|---|---|---|
| 1 | Add the penalty, tune the factor on preflop solves alone (minutes each) | ~1 day of work |
| 2 | Re-calibrate 100bb (2–3 rounds, as for 20/60bb) | ~4 h cloud, ~$5 |
| 3 | Full 100bb flop re-solve (new ranges change every flop) | ~30 h cloud, ~$30 |
| 4 | 60bb with the same penalty, for consistency: re-calibrate and re-run its flops | ~20 h cloud, ~$25 |
| 5 | Re-solve the 18 mixed-stack profiles | ~30 min local |

20bb doesn't need it: there's no 3-bet there, only calls and shoves.

**Note on step 4:** the 60bb flop run in progress (`solver/queue-cloud-stacks-v1-60.txt`, launched 2026-10-11) uses the chart without the penalty. If the penalty goes into 60bb too, that run's output is replaced.

## Checks

- `compareCharts.ts` against `preflop-v9`: changes only where expected (HJ/CO cold calls and the 3-bets that replace them; responses to those 3-bets).
- A table of premium-hand 3-bet frequencies by spot, like the one above, before and after.
- The flop spots for HJ/CO single-raised pots get narrower calling ranges; their frequencies in `spotFrequency.ts` drop.
