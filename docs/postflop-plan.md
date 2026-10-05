# Postflop plan

Decided 2026-09-30 to 10-01. This is a copy for machines without the Obsidian vault; the vault notes are `Projects/gtotutor-mvp-plan.md`.

## Decisions

- **Solver:** use b-inary/postflop-solver (Rust, AGPL-3.0, development suspended in 2023, pinned commit).
  - TexasSolver was rejected: its author requires a paid license for any use inside an app or website.
- **Flop: precomputed offline** on Jordan's desktop (Intel i7-11700K, 16 threads, 64 GB RAM).
  - The app looks up the stored strategies.
  - Real flops are mapped to the nearest solved flop (`apps/api/src/postflop/flopMap.ts`).
- **Turn and river: solved in the user's browser.**
  - Use b-inary's WASM build in a Web Worker, started as soon as the card is dealt.
  - Phones, and any failed solve, fall back to a cached or approximate strategy.
  - Browser-solved results are **never** written to the shared cache, because users could tamper with them.
- **AGPL:** the solver runs only offline (desktop) and in the browser (distributed with its source offered). Never on the live server. Get a legal read before charging money.
- **GPU doesn't help:** the solver is CPU-only.
- **Keep compute low** (2026-10-02): no ML model for now. Use cheap trees, few flops per spot, nearest-flop mapping, and browser solving for small spots.

## Spots

`npx tsx apps/api/scripts/exportSolverSpots.ts` writes 47 heads-up spots for 6-max 100bb: 15 single-raised, 15 3-bet, 15 4-bet, and 2 limped (SB limp-3bet has an empty range with the placeholder charts, so it is skipped). 5-bet all-ins need no solving; multiway pots can't be solved by this solver.

Tree: one bet and one raise size on the flop, one bet size and **no raises** on the turn and river.

## Measured

Desktop, one flop (Kh7d2c) unless noted:

| Spot | Memory per solve | Time per flop (16 threads) |
|---|---|---|
| BTN vs BB single-raised, old tree (turn/river raises) | 6.1 GB | 46s average over 584 flops |
| BTN vs BB single-raised, current tree | 2.5 GB | 14s average over 20 flops |
| Other single-raised spots, old tree | 1.4–4.1 GB | not measured |
| SB limped pot, old tree | 11.8 GB | not measured |
| 3-bet pots | 0.3–0.7 GB | 6s (53s on 1 thread) |
| 4-bet pots | about 0.1 GB | under 1s (3s on 1 thread) |

- **Dropping turn/river raises** (20 flops, `apps/api/scripts/compareSolves.ts`): flop strategy gives up 0.015 bb/hand against the full tree's EVs, versus 0.010 for the full tree's own strategy. That's about 0.005 bb/hand extra, for 3x less time.
- **Nearest solved flop** (`apps/api/scripts/nearestFlopTest.ts`, BTN vs BB, tested on 400 unseen flops): a hand's first-decision strategy differs from the real solve by 4.5% with 184 solved flops (5.7% with 100, 6.8% with 50; a random flop of the same shape: 8.7%). Unweighted, because those files have no reach weights.
- **4-bet pots** are small enough to solve live in the browser. 3-bet pots take ~1 minute on one thread, so precompute them (6s per flop).

## Data on disk

`solver/output/btn_vs_bb_srp_100`: the first 584 flops in the fixed order were solved with the old tree and have no `weights`/`equity`/`ev_bb` per node. Later flops use the current tree and have them; each file's `tree` field says which. Re-solving the 584 with the current tree would take about 2.3 hours.

Planned: move this output to a private Supabase Storage bucket (gzipped, indexed in the database) so any machine can serve flop play; see `docs/accounts-and-data.md`.

## Steps

1. [x] Spike: the solver builds; ranges export from the charts.
2. [x] Batch tool `solver/`: resumable, one JSON per flop, fixed sample order.
3. [x] **Desktop:** timed one flop, solved 584 BTN vs BB flops, measured all spots' memory, tested the cheaper tree and nearest-flop mapping.
4. [x] Load flop strategies into the API; map any flop to the nearest solved flop of the same suit/pairing shape (`apps/api/src/postflop/`).
5. [~] Engine: real flop betting from the solver for spots with solved flops; turn and river still run out automatically.
6. [~] UI: board, flop decisions, verdict with EVs and the borrowed flop, flop strategy grid per hand class. The coach gets the board and an approximation note.
7. [ ] Browser turn/river solving (WASM worker) with a fallback; 4-bet pot flops solved live too.
8. [ ] When the real preflop charts land: re-export spots, solve 184 frequency-matched flops per single-raised and 3-bet spot (about 8 single-raised spots after merging near-duplicates), and all flops for the most-played spots.

## Cost estimates (projections, not measured)

| Scope | Desktop |
|---|---|
| Rest of BTN vs BB (1,171 flops, current tree) | about 4–6 hours |
| 15 single-raised spots × 184 flops | about 10 hours |
| 15 3-bet spots × 184 flops | about 5 hours |
