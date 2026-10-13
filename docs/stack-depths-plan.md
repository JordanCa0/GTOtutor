# Stack depths plan: 20bb, 60bb, 100bb

**Status (2026-10-12): ready to launch, not live.** Launch steps are in `docs/deployment.md` ("Stack depths").
- **Charts:** 81 profiles in `preflop/charts/stacks-v1/`, listed in the manifest `preflop/charts/stacks-v1.json`:
  - 100bb is `preflop-v9.json`, unchanged;
  - 20bb and 60bb;
  - 18 tables with one short seat;
  - 60 with several: one 20bb and two 60bb at 100bb, every seating (solved with `preflop/solve-profiles.sh`).
- **Flops:** `solver/output/stacks-v1/`.
  - Every 20 and 60bb spot has 188 coverage-picked flops.
  - The six 20bb spots that make up 98.8% of 20bb flops are being filled in towards every flop on the desktop (`solver/queue-desktop-stacks-v1-20-full.txt`).
  - Full 60bb coverage (about 300 desktop hours, or a cloud run like v9's) is still to do. Until then 60bb flops use the nearest solved flop, labelled as approximate.
- **App (Phase 2):** done.
  - The setup offers Equal stacks, One short or Several short, dealing solved profiles only.
  - Postflop decisions at mixed tables are labelled approximate.
  - Mixed profiles load on demand.
  - The nearest-profile fallback for unsolved mixes isn't needed while only solved profiles are dealt.
- **Review (Phase 4):** `docs/stack-depths-review.md`. One open question there: whether a deep player facing a short stack should use the short tree.
- **To play locally:** set `PREFLOP_CHARTS` to the manifest and `SOLVER_OUTPUT_DIR` to both flop folders, comma-separated.

Builds on the live `preflop-v9` tree. Adds 20bb and 60bb next to today's 100bb, plus mixed-stack tables: a set of common setups solved exactly, and a nearest-match fallback for every other mix.

**Decisions (2026-10-11):**
- **20bb is mostly shove or fold.** A small tree: open-shoves, a small open for hands that want to see a flop, shoves over opens and limps. See "Bet sizes".
- **60bb keeps most of 100bb's options:** limps, opens, 3-bets, a real 4-bet size, then all-in.
- **Order:** 20bb first, then 60bb, then the mixed-stack profiles.
- **Mixed stacks are in the first release.**
- **Ship everything at once.** 20bb, 60bb and mixed stacks go live together, so nothing is visible in the app until all three are solved and reviewed.

## Goals

- **Equal stacks at 20, 60 and 100bb, solved preflop and on the flop.**
- **Mixed stacks:**
  - A handful of common setups get their own preflop solve (exact).
  - Any other mix uses the nearest solved setup and is labelled approximate in the app.
- **No re-solving at 100bb.** `preflop-v9.json` and `solver/output/preflop-v9/*_100` stay valid only if the 100bb tree, node keys and realization are left exactly as they are. Phase 1 checks this before anything else.

## How it works

- **A stack profile** is the stack of each position, UTG to BB.
  - Uniform profiles keep a plain depth as their id: `100`, `60`, `20`. That way every existing node key (`SIX_MAX|100|RFI|UTG`) stays the same.
  - Mixed profiles name the base depth plus the exceptions: `100:BB20` means everyone has 100bb except a 20bb BB. Node keys become `SIX_MAX|100:BB20|RFI|UTG`.
- **Preflop:**
  - One solve per profile, a few minutes each.
  - Each player's bet sizes follow their own stack (see "Bet sizes").
  - Each flop leaf uses realization for its effective stack.
- **Flop:**
  - Only the effective stack (the smaller of the two) matters heads-up. So flops are solved per uniform depth only: spot names end in `_20`, `_60` or `_100`.
  - A mixed-stack pot uses the flop solves for its effective depth.
  - The ranges and pot size can differ a little from the uniform solve, so the app labels the flop approximate, like `approxFlop` does today.
  - **No mixed-stack flop solving is planned.**
- **Turn and river:** nothing new. The live solver already takes the stack from each flop spot's `stack_bb` (`apps/api/src/postflop/liveSolve.ts`), so 20bb and 60bb turns solve as they are.
- **Fallback for unsolved mixes:**
  - At each decision, compare the actual stacks of the players still in the hand with every solved profile. Use the closest one (smallest log-distance between effective stacks, checked seat by seat).
  - An exact match is graded normally.
  - Anything else shows "Approximate: nearest solved stacks are <profile>". It isn't counted against the player's accuracy stats the same way.
- **Simple pots** (bots never limp or call ahead of hero) works the same at every depth: it only changes which actions the bots draw.

## Bet sizes

100bb stays exactly as v9 has it.

| | 100bb (v9, unchanged) | 60bb | 20bb |
|---|---|---|---|
| Open (first in) | 2.5 (SB 3) | 2.5 (SB 3) | 2.0, or all-in |
| Limp first in | any position | any position | SB only |
| Isolate a limp | 4.5 (BB vs SB 3.5) | 4.5 (BB vs SB 3.5) | all-in only |
| Limper vs isolation | fold, call, 3-bet to 11 | fold, call, 3-bet to 11 | fold or call (the iso is all-in) |
| 3-bet | 7.5 IP, 10 from the blinds | 7.5 IP, 10 from the blinds | all-in only |
| 4-bet | 22 | 20 | n/a |
| 5-bet | all-in | all-in | n/a |
| Flop bets | 33/66/100% | 33/66/100% | 33% or all-in |

- **20bb is a shove-or-fold game.**
  - First in, every position can fold, open to 2.0, or shove; the SB can also limp.
  - Facing an open or a limp, it's fold (or check in the BB), call an open, or shove.
  - Facing a shove, it's fold or call.
  - Only two kinds of 20bb pot reach a flop: a 2.0 open that was called, and an SB limp the BB checked. Everything else is all-in preflop and runs out.
  - The SPR in a called 2.0 open is about 4, so the flop tree is one small bet or all-in.
- **60bb is 100bb with a smaller 4-bet.** 20 leaves about 40bb behind, so the 5-bet is all-in.
- **In mixed profiles**, a player's sizes come from their own stack, capped by the effective stack against whoever they're raising. A 20bb player opens 2.0, while a 100bb player opens 2.5 even if a 20bb stack sits behind.

## Phases

### Phase 1: Preflop solver (1–2 days)
- `preflop/src/game.rs`:
  - Replace `STACK` with per-seat stacks in `State` (`all_in`, `apply`, `jam`).
  - Choose the action set and sizes from the acting player's stack (the table above). The 20bb tree drops limps outside the SB, the iso and 3-bet sizes, and the 4-bet.
  - Build `key()` from the profile id instead of the hardcoded `100`.
  - Add an effective-depth bucket to `RealKey`, and leave all-in leaves as they are.
- `preflop/src/realization.rs` and `main.rs`:
  - Take one realization file per depth: `--realization 100=realization/<file>.json --realization 20=…`. The 100bb curves and their names stay exactly as they are.
  - Add `--stacks <profile>`; the default is `100`.
- **Tests:**
  - **100bb regression first.** Re-solve `--stacks 100` with v9's realization file, then run `compareCharts.ts` against `preflop/charts/preflop-v9.json`. It must match within solver noise, or stop and fix before going on.
  - The existing heads-up push/fold test still passes.
  - New: a 20bb profile builds, and every node key is unique.
  - New: the 20bb SB folded-to strategy is close to the known heads-up push/fold ranges.
  - New: a mixed profile's short stack can't bet more than its stack.

### Phase 2: App and tooling (2–3 days)
- **Sizes in one place:** `apps/api/src/charts/fixtures.ts` gets sizes by depth (`openSize`, `threeBetSize`, `FOUR_BET_SIZE`, …), mirroring the Rust table.
- **`exportSolverSpots.ts`:**
  - `--stacks 20|60` writes spots ending in `_20`/`_60`, with pot and `stack_bb` from that depth's sizes, and the flop sizes from the table (20bb: `33%,a`).
  - Skip lines that are all-in preflop (no flop), which is most of 20bb.
- **Charts:** the API loads several chart files.
  - Change `PREFLOP_CHARTS` to take a manifest (`preflop/charts/stacks-v1.json`) mapping each profile to its file. `preflop-v9.json` is the `100` entry, unchanged.
  - `ChartService` reports which profiles exist.
- **Engine (`apps/api/src/engine/handEngine.ts`):**
  - Store per-seat stacks in `config`: `stackDepthBb` becomes the table default, plus optional per-position overrides.
  - Remove the 100bb-only check in `start()`.
  - `nodeKeyFor` picks the profile: exact match, or the fallback.
  - `spotName` uses the effective depth of the two players left.
  - All-in and call amounts use each seat's own stack.
  - `view()` uses per-seat stacks.
- **Shared types and UI:**
  - In `STACK_DEPTHS`, mark 20 and 60 available when the loaded charts have them. Until launch, production's manifest lists only `100`, so nothing shows early.
  - Add a "Mixed stacks" setup option that deals a random solved profile, or random stacks from {20, 60, 100}, which uses the fallback.
  - Show the approximate label on preflop decisions as well as flops.
  - Seats show their own stack, so a short stack stands out at the table.
- **Tests:**
  - Engine hands at 20bb and 60bb, with simple pots on and off.
  - A mixed table picks the exact profile when one exists, and the fallback otherwise.
  - `spotName` uses the effective depth.
  - 100bb hands are unchanged; existing tests pass untouched.

### Phase 3: Solving, in this order

Estimates scale v9's measured costs (`docs/game-tree-v9-plan.md`: ~380 desktop hours for 100bb with three flop sizes, ~27–30 h on a 64-core cloud instance). Measure the first runs and update these.

| Step | What | Compute |
|---|---|---|
| 3a | **20bb uniform:** preflop solve, then 3–4 calibration rounds (calibration spots at 60 flops, then re-solve preflop until fewer than 3% of decisions change), then flop coverage. Only called 2.0 opens and SB-limp pots reach a flop, with a two-size tree at SPR ~4, so this is small. | ~3–4 h calibration + ~10–20 desktop h of flops (~1–2 h in the cloud) |
| 3b | **60bb uniform:** same process. About as many spots as 100bb, with somewhat cheaper trees (less stack behind). | ~8–10 h calibration + ~200–300 desktop h of flops (~15–25 h in the cloud, ~$20–30) |
| 3c | **Mixed profiles, preflop only** (list below). They reuse the 20/60/100 realization files and flop solves. | ~1–2 h |
| 3d | **100bb:** nothing. Phase 1's regression check covers it. | 0 |

- **Where to run:** 3a fits on the desktop overnight. 3b goes to the cloud (`solver/cloud/`, `launch.ps1`, queue files per step), as v9 did.
- **Flop coverage for 20bb and 60bb**, matching 100bb:
  - every flop for the most common single-raised spots;
  - 885 for the SB-limp pot;
  - 103 for the rest.

  Rank the spots with `spotFrequency.ts` at each depth first, since the most common spots shift with depth.
- **Output folders:**
  - charts in `preflop/charts/stacks-v1/<profile>.json`;
  - flops in `solver/output/stacks-v1/<spot>_<depth>/`.
  - The 100bb flops stay in `solver/output/preflop-v9/`. `FlopStore` takes one folder per depth from the manifest.

**Mixed profiles to solve exactly:** one short stack at each position.

| Base | Short stack | Profiles |
|---|---|---|
| 100bb | one 20bb seat | `100:UTG20` … `100:BB20` (6) |
| 100bb | one 60bb seat | `100:UTG60` … `100:BB60` (6) |
| 60bb | one 20bb seat | `60:UTG20` … `60:BB20` (6) |

That's 18 profiles, each only a few minutes of preflop solving. More can be added the same way later, for example two short stacks, guided by which mixes players actually pick.

### Phase 4: Review and launch, all at once (about 1 day)
- **Review the 20bb, 60bb and mixed charts.**
  - Sanity checks: the 20bb SB folded-to range should come out close to known push/fold ranges, ranges should widen as stacks get shorter, a 20bb seat in a 100bb profile should play close to the uniform 20bb chart, and there should be no strange mixed strategies.
  - Use `compareCharts.ts` between depths.
- **Deploy** (see `docs/deployment.md`):
  1. Upload `solver/output/stacks-v1/` to the solver bucket.
  2. Add `preflop/charts/stacks-v1/` to the `COPY` line in `apps/api/Dockerfile`.
  3. Set `/gtotutor/PREFLOP_CHARTS` to the manifest, with every profile listed.
  4. Push the image and run `deploy.sh`.
- Update `CLAUDE.md` (what production runs) and this plan's status.

## Risks

- **The 100bb regression fails.** Some refactor detail changed the 100bb tree. Fix it until the charts match; re-solving 100bb (~380 desktop hours of flops) is the cost this plan avoids.
- **Realization at mixed effective depths.** A 20bb-vs-100bb pot uses 20bb realization, but the preflop pot geometry differs slightly from a uniform 20bb pot. Accept it, and check it with a few calibration flops in step 3c if the charts look odd.
- **20bb realization has little to calibrate on.** Few 20bb pots reach a flop, so the calibration spots are mostly called 2.0 opens. If the 2.0 open turns out almost never used, consider dropping it and making 20bb pure shove-or-fold.
- **Memory on the server.** More flop folders don't add cache memory: `FlopStore` keeps 64 flops across all spots. Disk grows by roughly 1–2 GB, which fits the 20 GB volume.
