# Postflop plan

Decided 2026-09-30 to 10-01. This is a copy for machines without the Obsidian vault; the vault notes are `Projects/gtotutor-mvp-plan.md`.

## Decisions

- **Solver:** use b-inary/postflop-solver (Rust, AGPL-3.0, development suspended in 2023, pinned commit).
  - TexasSolver was rejected: its author requires a paid license for any use inside an app or website.
- **Flop: precomputed offline** on Jordan's desktop (Ryzen, 64 GB RAM).
  - The app looks up the stored strategies.
  - Real flops are mapped to the nearest solved flop.
- **Turn and river: solved in the user's browser.**
  - Use b-inary's WASM build in a Web Worker, started as soon as the card is dealt.
  - Phones, and any failed solve, fall back to a cached or approximate strategy.
  - Browser-solved results are **never** written to the shared cache, because users could tamper with them.
- **AGPL:** the solver runs only offline (desktop) and in the browser (distributed with its source offered). Never on the live server. Get a legal read before charging money.
- **GPU doesn't help:** the solver is CPU-only.

## Measured so far

On a MacBook Air M2 with 8 GB:
- **2 flop sizes + raises:** the default tree needed 8.45 GB per solve (4.29 GB compressed), about 4 seconds per iteration. Too heavy for the Air.
- **One size per street:** the simplified tree in `spots/btn_vs_bb_srp_100.json` needs 6.4 GB per solve (3.2 GB compressed). Time per solve on the desktop is **still to be measured**.

## Steps

1. [x] Spike: the solver builds; ranges export from the charts.
2. [x] Batch tool `solver/`: resumable, one JSON per flop, fixed sample order.
3. [ ] **Desktop:** time one flop (`--flop Kh7d2c`), then run `--limit 184` for BTN vs BB.
4. [ ] Load flop strategies into the API; map any flop to its canonical solved flop.
5. [ ] Engine: real postflop betting (check/bet/raise on flop, turn and river) instead of the auto-runout.
6. [ ] UI: board decisions, strategy view by hand, verdict. The coach explains postflop spots.
7. [ ] Browser turn/river solving (WASM worker) with a fallback.
8. [ ] More spots (about 30 preflop lines), then rent a server if the desktop is too slow (Hetzner, about $120 for a month).

## Cost estimates (projections, not measured)

| Scope | Desktop | Cloud |
|---|---|---|
| 1 spot, 184 flops | overnight, about $1 of power | about $5–20 |
| 30 spots, about 5,500 solves | 2–4 weeks running 24/7 | about $60–600, depending on provider |
