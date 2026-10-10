# Postflop plan

Decided 2026-09-30 to 10-01. This is a copy for machines without the Obsidian vault; the vault notes are `Projects/gtotutor-mvp-plan.md`.

## Decisions

- **Solver:** use b-inary/postflop-solver (Rust, AGPL-3.0, development suspended in 2023, pinned commit).
  - TexasSolver was rejected: its author requires a paid license for any use inside an app or website.
- **Flop: precomputed offline** on Jordan's desktop (Intel i7-11700K, 16 threads, 64 GB RAM).
  - The app looks up the stored strategies.
  - Real flops are mapped to the nearest solved flop (`apps/api/src/postflop/flopMap.ts`).
- **Turn and river: solved live on AWS by a separate solver service** (decided 2026-10-09; replaces browser solving).
  - When a hand reaches the turn, the API asks the solver service to solve the rest of the hand. It starts as soon as the card is dealt; design in "Live turn and river solving" below.
  - The service runs on AWS Lambda, so it costs nothing when idle and scales with players.
  - Results go into a shared cache, kept by the API in S3, so players who reach the same spot, flop line, turn and river reuse one solve.
  - Phones get the same solves as desktops.
  - Any failed or slow solve falls back to running the hand out, as today.
  - Precomputing turns was rejected: about 340,000 turn solves per spot, and terabytes of storage.
  - The browser (WASM) solver is no longer planned. It could come back later as an extra for desktops.
- **AGPL (rule changed 2026-10-09):** the solver may now run as part of the live system, as a separate solver service, under the conditions in "AGPL conditions" below. Get a legal read before charging money.
- **GPU doesn't help:** the solver is CPU-only.
- **Keep compute low** (2026-10-02): no ML model for now. Use cheap trees, few flops per spot, nearest-flop mapping, and live solving for the small parts of the game (turn, river, and maybe 4-bet pot flops).

## AGPL conditions

postflop-solver is AGPL-3.0. Its network clause (section 13) says that if users interact with a modified version over a network, they must be offered its source. These conditions keep that obligation limited to the solver service and easy to meet:

1. **Separate program.** The solver runs only inside its own service: its own Lambda function, built from `solver/`.
   - The API and the web app talk to it only by sending JSON requests and receiving JSON responses.
   - The solver is never linked into, imported by, or run inside the API or web app process.
   - It doesn't share code with them beyond the request/response format.
2. **Source offered to users.**
   - The service's complete source is public under AGPL-3.0: `solver/`, its build and deploy scripts, and the pinned postflop-solver commit plus any changes to it.
   - Add a `LICENSE` file (AGPL-3.0) to `solver/`, and keep the upstream copyright notices.
3. **A link in the app.** An "About / credits" or footer link says live turn and river strategies come from postflop-solver (AGPL-3.0). It points to the solver source **at the exact commit deployed**; the service reports its commit with each response.
4. **Changes are published.** Any change to postflop-solver itself goes in a public fork or patch, pinned like today. Deploy only commits that are pushed to GitHub.
5. **Only data crosses the boundary.** The service gets the board, ranges, pot, stacks and tree settings, and returns strategies and EVs.
   - It has no database access, no player data and no secrets.
   - Its IAM role can only write its own logs: the API keeps the solve cache.
   - Only the API can invoke it: no public URL.
6. **App code stays separately licensed.** The rest of the repo has no license yet, so all rights are reserved by default. Choose one deliberately, and don't let AGPL code move into `apps/` or `packages/`.
7. **Legal read before charging money,** as before. Ask specifically whether a paid app that calls a separate AGPL service needs anything beyond conditions 1–6.
8. **The precomputed flops are unaffected.** Shipping solver output (JSON) was always fine.

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
- **4-bet pots** are small enough to solve live (under 1s each; with the solver service, step 7). 3-bet pots take ~1 minute on one thread, so precompute them (6s per flop).
- **Solver noise floor** (2026-10-05, 20 flops):
  - 1% solves vs 0.25% solves of the same flops lose ~0.003 bb/hand extra, about 0.05% of pot.
  - Yet their root frequencies already differ by 3.5%. So most of the "4.5% strategy difference" above is solver noise, not mapping.
- **Mapping EV loss** (`flopEvLoss.ts`, BTN vs BB on placeholder ranges, 300 held-out flops; the solve's own baseline is 0.27%):

  | Solved flops | Nearest flop |
  |---|---|
  | 100 | 2.26% of pot |
  | 184 | 1.97% |
  | 400 | 1.50% |
  | 700 | 1.30% |

  - Blending the 3 nearest flops is worse than using one (2.15% vs 1.73% at 184, 150 test flops).
  - Mapping alone can't reach a 1% budget, so the most-played spots need every flop solved.
- **Realization** (`calibrateRealization.ts`, 40–60 flops per spot on charts preflop-v2):
  - Single-raised pots: the BB caller realizes 0.74–0.75 out of position vs BTN/CO; the in-position raiser 1.18–1.19.
  - SB as out-of-position raiser vs BB: 0.98.
  - Realization depends on preflop role as well as position, so calibration keys on both.

- **Live turn solves** (2026-10-10, desktop, `solver/src/bin/turn-bench.rs`):
  - **Inputs:** preflop-v9 flops, the turn plus every river, solved to 1% of pot.
  - **Ranges:** turn-start ranges are rebuilt as preflop weight × each flop action's frequency on the line. This reproduces the solver's stored reach to within 1% (`live::tests`).
  - **Trees:** a = one size, no raises; b = turn 33/75%, river 50/100%; c = turn 33/75/125%, river 50/100%/all-in, one raise (3x); d = c without the raise; e = b with one raise.

  | Tree | SRP check-check, 6 threads (1 thread) | SRP bet-call, 6 threads | SB limped pot, 6 threads (2 threads) | Memory |
  |---|---|---|---|---|
  | a | 0.06s | 0.10s | 0.07s | 6–8 MB |
  | b | 0.15s (0.59s) | 0.16–0.23s | 0.19s | 15–16 MB |
  | c | 4.8s (21s) | 2.5–3.0s | 18s (45s) | 100–250 MB |
  | d | 0.73s (1.8s on 2) | — | 1.9s (4.2s) | 32 MB |
  | e | 1.9s (5.3s on 2) | — | 3.5s (9.1s) | 106–170 MB |

  - **Export:** walking every river card is 8 MB (tree a) to 460 MB (c, limped pot) of JSON, so a solve returns river decisions only for the river cards asked for (`riverCards`). The server deals the river in advance.
  - **Result:** turns are far faster than the 8 s gate for every tree except c in limped pots. Graviton (Lambda) timings are still to come, in Phase 2.

## Data on disk

`solver/output/btn_vs_bb_srp_100`: the first 584 flops in the fixed order were solved with the old tree and have no `weights`/`equity`/`ev_bb` per node. Later flops use the current tree and have them; each file's `tree` field says which. Re-solving the 584 with the current tree would take about 2.3 hours.

Production serves this output from a private S3 bucket synced to the API server's disk (`docs/deployment.md`). The `preflop-v8` output is about 3.6 GB.

## Steps

1. [x] Spike: the solver builds; ranges export from the charts.
2. [x] Batch tool `solver/`: resumable, one JSON per flop, fixed sample order.
3. [x] **Desktop:** timed one flop, solved 584 BTN vs BB flops, measured all spots' memory, tested the cheaper tree and nearest-flop mapping.
4. [x] Load flop strategies into the API; map any flop to the nearest solved flop of the same suit/pairing shape (`apps/api/src/postflop/`).
5. [~] Engine: real flop betting from the solver for spots with solved flops; turn and river still run out automatically.
6. [~] UI: board, flop decisions, verdict with EVs and the borrowed flop, flop strategy grid per hand class. The coach gets the board and an approximation note.
7. [ ] Live turn and river solving on AWS (design in "Live turn and river solving"):
   1. [x] **Measure first** (2026-10-10, see Measured: under 2 s for trees a, b and d). Add a mode to `solver/` that solves the turn and river from a stored flop line.
      - Time it on the desktop and on Graviton (one core, and 2–6 cores), with memory per solve.
      - Go ahead only if a turn takes a few seconds; otherwise reconsider the tree or the plan.
   2. [x] **Solver service** (2026-10-10): `solver/src/bin/live.rs`, a Lambda container image (`solver/lambda/Dockerfile`, arm64) or `live --serve <port>` for development.
      - JSON in and out, the commit in each response, `solver/LICENSE` (AGPL-3.0).
      - `solver/cloud/lambda-deploy.ps1` builds, pushes and deploys it (only pushed, clean commits); `lambda-test.ps1` times it.
      - [ ] Deploy it and time it on Graviton.
   3. [x] **API:** `src/postflop/liveSolve.ts` builds requests, `liveSolver.ts` runs them (S3 cache, rate limits, 20 s timeout, fall back to running the hand out). On with `TURN_SOLVER_LAMBDA` or `TURN_SOLVER_URL`.
   4. [x] **Engine:** turn and river betting from the solve, graded like flop decisions; bot replies pre-drawn on the flop so turn solves start while hero thinks.
   5. [x] **UI:** turn and river decisions, a "Solving the turn…" state, the run-out note, and the source link (AGPL condition 3).
      - [ ] Turn on in production (`docs/deployment.md`, "Live turn and river solving").
   6. [ ] **Later:** 4-bet pot flops solved live too (under 1s each), instead of precomputed.
8. [~] Real preflop charts: the `preflop/` solver (see `preflop/README.md`), calibrated against flop solves.
   - **Frozen: preflop-v8** (`preflop/charts/FROZEN`), on the rank-based realization model. v7→v8 changed 3.1% of decisions, weighted by how often they come up.
   - Open doubts that need a reference solution:
     - BB 3-bets small suited connectors and 44–99 against a BTN open.
     - Early-position opens look 3–5 points wide.
   - The engine now keeps pots heads-up (no calling after a call; `|nocall` chart nodes), so every flop has a spot.
   - **Flop re-solve on v8:** `solver/queue-preflop-v8.txt`, resumable, progress on port 7878.
     1. 150 flops each for SB/BTN/CO/HJ/UTG vs BB single-raised (43.6% of flops).
     2. 100 flops for every other spot that's at least 1% of flops.
     3. Every flop for the top five.
   - Earlier versions' output (`solver/output/preflop-v2…v7`) is calibration data only.

## Live turn and river solving

**Status (2026-10-10):** built and tested locally (step 7); not yet deployed. Turns take 0.2–5 s on 6 threads (Measured).

- **Inputs come from the stored flop solve.** Each flop file has, for every flop decision, each hand's reach (`weights`). The ranges at the start of the turn are those reaches along the flop line actually played.
- **Solve in the solved flop's cards.**
  - When the real flop was mapped to a nearest solved flop, the turn card is mapped the same way (`CardMapper` in `apps/api/src/postflop/flopMap.ts`).
  - The turn is solved on the mapped board, so the ranges and the board match.
  - Hands map back to the real cards, as they do on the flop.
- **Tree:** turn 33/75/125%, river 50/100%/all-in, one 3x raise (chosen 2026-10-10). Limped pots drop the raise, because their wide ranges made it take 18 s. Accuracy target: 1% of the pot. The flop was solved with one-size later streets, so the turn re-solves with a richer tree, as commercial tools do.
- **The river comes with it.** The server deals the river in advance (the deck is shuffled at the start), so a turn solve returns the river decisions for that one river card, for every turn line. Every river card would be up to 460 MB of JSON.
- **Cache.** S3 `turn-cache/<spot>/<board>/<hash>.json`, where the hash covers the whole request (ranges, board, river card, tree), so any change is a new entry. Written only by the API, never by clients, so users can't tamper with them.
- **Speculative solves.** When hero's flop decision comes up, the engine draws the bot's reply to each of hero's options in advance (same frequencies, drawn earlier; never sent to the client). Every option whose line then reaches the turn starts its solve at once, so the turn is usually ready when it's dealt. At most 3 per decision; they count towards the rate limits.
- **Time budget.** If the solve isn't back within 20 seconds of the turn (`LIVE_SOLVE_TIMEOUT_MS`), or fails, the hand runs out as before and the player is told why. A restarted server fetches the solve again (a cache hit).
- **Cost (estimate).**
  - Lambda: 10 GB (for 6 vCPUs) × 1–6 s ≈ $0.0002–0.0008 per uncached solve on arm64, so 10,000 a month is about $2–8.
  - S3: pennies.
  - Limits: uncached solves per player (`LIVE_SOLVES_PER_HOUR`, default 300) and overall (`LIVE_SOLVES_GLOBAL_PER_HOUR`, default 3000), like the coach's; plus the function's concurrency cap.
- **Security.** Only the API can invoke the function (IAM); it has no URL. Its role can only write logs. No database access, no secrets (AGPL condition 5).

## Cost estimates (projections, not measured)

| Scope | Desktop |
|---|---|
| Rest of BTN vs BB (1,171 flops, current tree) | about 4–6 hours |
| 15 single-raised spots × 184 flops | about 10 hours |
| 15 3-bet spots × 184 flops | about 5 hours |
