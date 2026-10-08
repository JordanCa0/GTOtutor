# Stack depths plan: 20bb, 60bb, 100bb

**Status (2026-10-08): planned and parked; not started.** Picked up again after the chart-explorer work. Adds 20bb and 60bb next to today's 100bb, plus a few tables where stacks differ (solved exactly) and a nearest-match fallback for every other mix.

## Goals

- **Equal stacks at 20, 60 and 100bb, solved preflop and on the flop.**
- **Mixed stacks:**
  - A handful of common setups get their own preflop solve (exact).
  - Any other mix uses the nearest solved setup and is labelled approximate in the app.
- **No re-solving at 100bb.** `preflop-v8.json` and `solver/output/preflop-v8/*_100` stay valid only if the 100bb tree, node keys and realization are left exactly as they are. Phase 1 checks this before anything else.

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
- **Fallback for unsolved mixes:**
  - At each decision, compare the actual stacks of the players still in the hand with every solved profile. Use the closest one (smallest log-distance between effective stacks, checked seat by seat).
  - An exact match is graded normally.
  - Anything else shows "Approximate: nearest solved stacks are <profile>". It isn't counted against the player's accuracy stats the same way.

## Bet sizes (decision needed)

100bb stays exactly as it is now. Proposed sizes for the others:

| | 100bb (unchanged) | 60bb | 20bb |
|---|---|---|---|
| Open | 2.5 (SB 3) | 2.5 (SB 3) | 2.0 (SB 2.5), or open all-in |
| SB limp, BB iso | yes, iso 3.5 | yes, iso 3.5 | limp yes; BB options check or all-in |
| 3-bet | 7.5 IP, 10 blinds | 7.5 IP, 10 blinds | all-in only |
| 4-bet | 22 | 20 | n/a |
| 5-bet | all-in | all-in | n/a |

- **At 20bb**, all-in-only 3-bets keep the tree small. Short-stack solvers agree that small 3-bets matter little at this depth.
- **In mixed profiles**, a player's sizes come from their own stack, capped by the effective stack against whoever they're raising. A 20bb player opens 2.0, while a 100bb player opens 2.5 even if a 20bb stack sits behind.

## Phases

### Phase 1: Preflop solver (1–2 days)
- `preflop/src/game.rs`:
  - Replace `STACK` with per-seat stacks in `State` (`all_in`, `apply`, `jam`).
  - Choose sizes from the acting player's stack (table above).
  - Build `key()` from the profile id.
  - Add an effective-depth bucket to `RealKey`, and leave all-in leaves as they are.
- `preflop/src/realization.rs` and `main.rs`:
  - Take one realization file per depth: `--realization 100=realization/<file>.json --realization 20=…`. The 100bb curves and their names stay exactly as they are.
  - Add `--stacks <profile>`; the default is `100`.
- **Tests:**
  - **100bb regression first.** Re-solve `--stacks 100` with v8's realization file, then run `compareCharts.ts` against `preflop/charts/preflop-v8.json`. It must match within solver noise, or stop and fix before going on.
  - The existing heads-up push/fold test still passes.
  - New: a 20bb profile builds, and every node key is unique.
  - New: a mixed profile's short stack can't bet more than its stack.

### Phase 2: App and tooling (2–3 days)
- **Sizes in one place:** `apps/api/src/charts/fixtures.ts` gets sizes by depth (`openSize`, `threeBetSize`, `FOUR_BET_SIZE`, …), mirroring the Rust table.
- **`exportSolverSpots.ts`:**
  - `--stacks 20|60` writes spots ending in `_20`/`_60`, with pot and `stack_bb` from that depth's sizes.
  - Skip lines that are all-in preflop (no flop), such as 20bb 3-bet pots.
- **Charts:** the API loads several chart files.
  - Change `PREFLOP_CHARTS` to take a manifest (`preflop/charts/stacks-v1.json`) mapping each profile to its file. `preflop-v8.json` is the `100` entry, unchanged.
  - `ChartService` reports which profiles exist.
- **Engine (`apps/api/src/engine/handEngine.ts`):**
  - Store per-seat stacks in `config`: `stackDepthBb` becomes the table default, plus optional per-position overrides.
  - Remove the 100bb-only check on line 139.
  - `nodeKeyFor` picks the profile: exact match, or the fallback.
  - `spotName` uses the effective depth of the two players left.
  - All-in and call amounts use each seat's own stack.
  - `view()` uses per-seat stacks.
- **Shared types and UI:**
  - In `STACK_DEPTHS`, mark 20 and 60 available when the loaded charts have them.
  - Add a "Mixed stacks" setup option that deals a random solved profile, or random stacks from {20, 60, 100}, which uses the fallback.
  - Show the approximate label on preflop decisions as well as flops.
- **Tests:**
  - Engine hands at 20bb and 60bb.
  - A mixed table picks the exact profile when one exists, and the fallback otherwise.
  - `spotName` uses the effective depth.
  - 100bb hands are unchanged; existing tests pass untouched.

### Phase 3: Solving (compute; projections from measured times in `docs/postflop-plan.md`)

| Step | What | Compute |
|---|---|---|
| 3a | **20bb uniform:** preflop solve, then 3–4 calibration rounds (calibration spots at 60 flops, then re-solve preflop until fewer than 3% of decisions change), then full flop coverage at 20bb | ~3–4 h calibration + ~5–10 h flops |
| 3b | **60bb uniform:** same process | ~8–10 h calibration + ~30–35 h flops |
| 3c | **Mixed profiles, preflop only** (list below). They reuse the 20/60/100 realization files and flop solves. | ~1–2 h |
| 3d | **100bb:** nothing. Phase 1's regression check covers it. | 0 |
| | **Total** | **~50–60 h** |

That's about 2–3 days with the desktop running around the clock, or 1–1.5 weeks running overnight (`solver/run-queue.ps1` with queue files per step).

- **Flop coverage for 20bb and 60bb**, matching 100bb:
  - every flop for the 7 most common single-raised spots;
  - 885 for the limped pot;
  - 103 for the rest.

  Rank the spots with `spotFrequency.ts` at each depth first, since the most common spots shift with depth.
- **Output folders:**
  - charts in `preflop/charts/stacks-v1/<profile>.json`;
  - flops in `solver/output/stacks-v1/<spot>_<depth>/`.
  - The 100bb flops stay in `solver/output/preflop-v8/`. `FlopStore` takes one folder per depth from the manifest.

**Mixed profiles to solve exactly (proposal):** one short stack at each position.

| Base | Short stack | Profiles |
|---|---|---|
| 100bb | one 20bb seat | `100:UTG20` … `100:BB20` (6) |
| 100bb | one 60bb seat | `100:UTG60` … `100:BB60` (6) |
| 60bb | one 20bb seat | `60:UTG20` … `60:BB20` (6) |

That's 18 profiles, each only a few minutes of preflop solving. More can be added the same way later, for example two short stacks, guided by which mixes players actually pick.

### Phase 4: Review and launch (about 1 day)
- **Review the 20bb and 60bb charts.**
  - Sanity checks: the SB folded-to range at 20bb should come out close to known push/fold ranges, ranges should widen as stacks get shorter, and there should be no strange mixed strategies.
  - Use `compareCharts.ts` between depths.
- **Deploy** (see `docs/deployment.md`):
  1. Upload `solver/output/stacks-v1/` to the solver bucket.
  2. Add `preflop/charts/stacks-v1/` to the `COPY` line in `apps/api/Dockerfile`.
  3. Set `/gtotutor/PREFLOP_CHARTS` to the manifest.
  4. Push the image and run `deploy.sh`.
- **Decision needed:** 20bb and 60bb exist only as solved charts, and the placeholders only cover 100bb. Showing them in production means turning on solved charts (`PREFLOP_CHARTS`), which CLAUDE.md keeps opt-in until they're reviewed. This phase's review is that sign-off.

## Risks

- **The 100bb regression fails.** Some refactor detail changed the 100bb tree. Fix it until the charts match; re-solving 100bb (~55–60 h of flops) is the cost this plan avoids.
- **Realization at mixed effective depths.** A 20bb-vs-100bb pot uses 20bb realization, but the preflop pot geometry differs slightly from a uniform 20bb pot. Accept it, and check it with a few calibration flops in step 3c if the charts look odd.
- **Memory on the server.** More flop folders don't add cache memory: `FlopStore` keeps 64 flops across all spots. Disk grows by roughly 1–2 GB, which fits the 20 GB volume.
