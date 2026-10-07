# GTOtutor preflop solver

Solves 6-max, 100bb preflop play and writes the charts the app uses. Its output replaces the placeholder `fixture-v2` charts (`apps/api/src/charts/fixtures.ts`).

This is our own code with no postflop-solver dependency, so it isn't AGPL. Its output and the binary itself can be used anywhere.

## What it solves

- **The same game as the app's hand engine** (`apps/api/src/engine/handEngine.ts`):
  - same sizes: opens 2.5 (SB 3), 3-bets 7.5 (blinds 10), 4-bets 22, 5-bet all-in, SB limp, BB iso 3.5, SB 3-bet 11
  - same action order
  - same chart lookup (`nodeKeyFor`)
- **One strategy per chart node.** Every decision is filed under its chart node key, so the solved strategy is exactly what the engine plays.
- **Discounted CFR over the 169 hand classes.** About 8s per 100 iterations on the desktop.

## Simplifications

- **Postflop isn't solved.** A hand that sees a flop gets pot × equity × *realization*: the share of its equity it turns into pot share. Realization = f(q) × g(class):
  - **q** is where the hand ranks inside its own range at that flop (0 = weakest, 1 = strongest), by equity against the opponent's range.
  - **f** is a curve over q per pot type, position and preflop role (e.g. `srp|oop_caller`).
  - **g** is a playability multiplier per hand class (suited, connected, …), shared by every spot.
  - Ranking within the range is what lets a weak hand inside a strong range (a 3-bet, say) still realize like a weak hand. The earlier per-class model kept 3-betting junk because it inherited the 3-bet range's success.
  - **Updates while solving.** q depends on the ranges, so the solver recomputes every flop's realization from the average strategy every 50 iterations. It holds them fixed for the last fifth of the iterations.
  - **Starting point.** The model starts from rough curves in `src/realization.rs`, then gets measured from flop solves (see "Calibration").
- **Flops are heads-up.**
  - A player may only call when at most one other live player has already matched the bet. They can still fold or raise.
  - This matches the flop solver, which only does heads-up pots.
  - The decisions where calling is blocked (facing an open and a caller, for example) get their own strategy under the node key plus `|nocall`.
  - The app's engine applies the same rule and uses those nodes. For charts without them, `ChartService` derives them by turning calls into folds.
- **Card removal between players is ignored.** Each class is dealt with probability combos/1326.
- **Equities are Monte Carlo** (20,000 samples per class matchup, cached in `cache/`).

## Run

From `preflop/`:

```powershell
cargo test --release          # evaluator, equities, the tree, and heads-up push/fold vs known Nash
cargo run --release -- --iterations 1500 --version preflop-v3 --realization realization/r1.json
```

- Output: `charts/<version>.json`.
- Each node has its actions, the strategy and EV (net bb from the start of the hand) per class, and `reach` (the chance of getting to the node with each class).
- Exploitability is printed every 250 iterations, in mbb/hand per player. It's measured against players who switch actions per chart node, so it respects what the charts can see.
- The final line also gives the figure against a best response that sees the whole action history. That's what the chart abstraction itself gives up (about 47 mbb/hand per player), not solver error.

## Use the charts

- **Spots for the flop solver:**
  ```bash
  npx tsx apps/api/scripts/exportSolverSpots.ts --charts preflop/charts/<version>.json
  ```
  This writes `solver/spots/<version>/`. Solve into `solver/output/<version>/` (`--out output/<version>`) so solves from different charts never mix.
- **In the app:** start the API with `PREFLOP_CHARTS=preflop/charts/<version>.json` and `SOLVER_OUTPUT_DIR=solver/output/<version>`. Without them it uses the placeholders.
- **Compare two versions:**
  ```bash
  npx tsx apps/api/scripts/compareCharts.ts <a.json> <b.json>
  ```

## Calibration

Realization factors come from the flop solver.

1. Solve a random sample of flops for a few spots per pot type on the current charts.
2. Measure realization from them (`ev_bb / (pot × equity)` at the flop root, per class), binned by rank in range, with the playability multiplier as what's left over:
   ```bash
   npx tsx apps/api/scripts/calibrateRealization.ts preflop/realization/<name>.json solver/output/preflop-v*/<spot> …
   ```
   - Pass the solves from **every** round, not just the latest. Each version counts equally, which damps the back-and-forth between rounds.
   - The calibration spots cover every pot type and role:
     - 4-bet pots: BTN vs BB, SB vs BB
     - 3-bet pots: BTN vs BB, CO vs BTN
     - single-raised pots: SB vs BB, CO vs BB, BTN vs BB
     - limped pots: SB vs BB iso and limp
   - 60 flops each (40 for the limped pots); the queue files are `solver/queue-calib-<version>.txt`.
3. Re-solve preflop with `--realization`, compare the charts, and repeat until fewer than 3% of decisions change (weighted by how often they come up).

Roles with no measurements use the built-in curve. Classes never measured use the built-in shape as playability.
