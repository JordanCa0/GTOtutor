# Game tree v9 plan: limping from every position, flop bets 33/66/100%

**Status (2026-10-09): phase 2 (preflop limping) built; phase 1 measuring; phase 3 next.** Two game-tree changes, made together so everything is re-solved once:

- **Limping from every position.** Today only the SB can limp.
- **Three flop bet sizes: 33%, 66% and 100% of the pot,** each with a 3× raise. Today the flop has one size (33%).

## Why together

- **Limping changes the preflop charts.** Some hands move from open or fold to limp, which makes a new chart version, `preflop-v9`. New charts change the ranges reaching every flop, so every flop spot needs re-solving whatever the bet sizes.
- **New flop sizes change every flop solve anyway.**
- **One re-solve covers both.** The `preflop-v8` flop output (`solver/output/preflop-v8/`, plus the S3 copy under `solver-runs/preflop-v8/`) stays as calibration data only, as earlier versions' output does.

The cloud run on v8 was stopped on 2026-10-09 for this reason. Production doesn't use the v8 flops: it still runs the placeholder charts.

## Limping from every position

- **What the player sees:**
  - **Folded to you in UTG–BTN:** fold, limp (call 1bb), or raise to 2.5.
  - **SB:** completes for 0.5 more, as today.
  - **Someone already limped:** no over-limping; the options are fold or raise. The heads-up rule (no calling once two players, the limper and the BB, have matched the bet) is what keeps every flop a two-player pot the flop solver can solve. Allowing over-limps would mean multiway pots with no flop solves.
- **Preflop tree** (`preflop/src/game.rs` `chart_node`/`apply`, and the engine's `nodeKeyFor` and `apply`, which mirror each other):
  - **First in (`RFI`):** every position gets fold, limp or open. Only the SB has a limp today.
  - **Facing a limp:** every player behind the limper gets a `VS_LIMP` node with check (BB) or fold (others) and an isolation raise.
    - Calling behind is blocked by the heads-up rule: two players (the limper and the BB) have already matched the bet. Those nodes are `|nocall`.
    - If nobody raises, the hand is limper vs BB, heads-up.
  - **The limper facing an isolation raise (`VS_ISO`):** fold, call or re-raise to 11. After a re-raise, the isolator uses `VS_3BET|<isolator>|<limper>`, then the usual 4-bet and 5-bet nodes. These keys can't collide with ordinary open/3-bet lines, where the 3-bettor always acts after the opener.
  - **Everyone else behind an isolation raise folds automatically,** hero included, so the pot is always limper vs isolator (built 2026-10-09).
    - Letting a third player call or 3-bet would put those lines on the same chart nodes as ordinary open/3-bet lines, but with different sizes.
    - Limps are rare at equilibrium, so this costs little.
    - A hand where hero is folded this way before any decision is redealt, like a walk in the BB.
  - **Sizes (decision needed):**
    - isolation raise to 3.5 plus 1 per limper, so 4.5 against one limper in position. Today's BB isolation raise vs the SB stays 3.5.
    - limp-re-raise to 11, as the SB today.
- **Placeholder charts** (`apps/api/src/charts/fixtures.ts`, the app's default): add limp options with 0% frequency, so the default app grades limps ("the chart limps here 0%") rather than refusing them.
- **Realization:** the new pot types (`limp`, `iso`, `l3b` for positions other than SB vs BB) start from the built-in curves. They're calibrated from flop solves like the others, at about 40 flops per new type, for the types that actually come up.
- **New flop spots:** about 35.
  - 5 limped pots: UTG, HJ, CO and BTN vs BB, plus SB vs BB.
  - ~15 limp-isolate pots.
  - ~15 limp-re-raise pots.
  - `exportSolverSpots.ts` writes them; `spotName` in the engine names them.
- **Expected effect:** at 100bb with no rake, solvers limp very little outside the SB. These spots should rank near the bottom in `spotFrequency.ts`, so they get a sample of flops plus nearest-flop mapping rather than every flop.

## Flop bet sizes 33 / 66 / 100%

- **Solver spots:** `exportSolverSpots.ts` writes `flop: ['33%,66%,100%', '3x']`. The turn (66%) and river (75%) stay one size with no raises.
- **Tree size:** the flop lines that continue to the turn grow from 5 to 13. Expect each solve to take about 2.5–3× longer and use about 2.5× the memory (up to ~6–7 GB per single-raised-pot solve). Measured in phase 1.
- **App:**
  - **Engine:** reads flop actions from each file (`parseSolverAction` in `apps/api/src/postflop/flopStore.ts`), so extra sizes need little engine change. Check the labels, all-in thresholds and history keys.
  - **UI:** a separate shade per bet size in the strategy grid, verdict and action buttons (`actionColors.ts`); today every bet shares one "bet" colour.
  - **Grading (decision needed):**
    - **Proposed:** when the chosen size is wrong but betting is right, grade on the frequency of betting at any size plus the EV of the chosen size. Call it "right idea, different size" when the EV loss is small.
    - Only a size the solver never uses counts as a mistake.
- **Storage:** flop files grow about 2.5×: ~3.6 GB becomes ~9 GB for a full chart version. Grow the API server's disk from 20 to 30 GB (`docs/deployment.md`; about $1/month).
- **Live turn/river solving** (`docs/postflop-plan.md`, step 7) is unaffected per solve. More flop lines spread the cache thinner.

## Phases

1. **Measure (half a day).**
   1. Solve ~20 flops of BTN vs BB single-raised with the 3-size flop tree, on v8 ranges.
   2. Record time and memory against the 1-size tree (`compareSolves.ts`).
   3. Check the 33/66/100 strategy uses all three sizes meaningfully. If one size gets almost no use, drop it before paying for it in every solve.
2. **Preflop limping (1–2 days).**
   - Preflop solver tree and tests. The existing push/fold and tree tests still pass.
   - Engine `nodeKeyFor`/`apply`, the placeholder charts, and the `|nocall` derivation in `ChartService`.
   - Engine tests: open-limps from each position, isolation, limp-re-raise, and the heads-up rule.
3. **Flop sizes in the app (1–2 days).**
   - Spot export, the engine checks above, action shades, grading rules, and the coach context.
   - Tests with a 3-size flop file.
4. **Calibrate and freeze `preflop-v9` (2–3 nights).**
   - Calibration rounds as in `preflop/README.md`, adding the new limped-pot roles.
   - Stop when fewer than 3% of decisions change, then freeze with `preflop/charts/FROZEN`.
5. **Re-solve every flop for v9 in the cloud** (`solver/cloud/`; see the next section).
   1. Export the spots (`--charts preflop/charts/preflop-v9.json`).
   2. Write a queue ordered by `spotFrequency.ts`: every flop for spots that are at least 1% of flops, and ~184 flops for the rest.
6. **Ship.** Upload the v9 flops to the server bucket, grow the server disk, and turn on the solved charts after review (CLAUDE.md keeps them opt-in until then).

## Solving cost (estimates; phase 1 replaces them with measurements)

| | Desktop hours |
|---|---|
| Today's tree, every flop of every spot, from scratch | ~155 |
| 3 flop sizes (×2.5–3) | ~390–465 |
| New limp spots at sample coverage | ~10 |
| **Total** | **~400–475** |

- **Spot quota:** 64 vCPUs (approved 2026-10-09).
- **On a 64-core instance** (`c7g.16xlarge`, `launch.ps1`'s default; ~14× the desktop, 4 solver processes × 16 threads): about **30–35 hours**, roughly **$25–40 in credits**.
- **Memory:** 4 processes × ~7 GB fit easily in 128 GB.

## Effect on other plans

- **Live turn/river solving** (`docs/postflop-plan.md`, step 7): build it on the v9 tree. The turn-solve timing (step 7.1) can still be measured on v8 files, since the turn tree doesn't change.
- **Stack depths** (`docs/stack-depths-plan.md`): its preflop and flop costs grow by the same factors. Do it after v9, on the v9 tree.
