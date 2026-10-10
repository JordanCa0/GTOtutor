# GTOtutor flop solver

This tool precomputes postflop (flop) strategies offline. It wraps [b-inary/postflop-solver](https://github.com/b-inary/postflop-solver).

For one preflop spot, it solves many flops and writes one JSON file per flop to `output/<spot>/<flop>.json`. That file holds the flop-street strategy for every hand, plus each hand's equity and EV. The app loads these files.

The turn and river are solved live by `live` (`src/bin/live.rs`), a separate solver service on AWS Lambda; see "Live solver service" below. The full plan is in [`docs/postflop-plan.md`](../docs/postflop-plan.md).

## License

postflop-solver (Copyright (C) 2022 Wataru Inariba) is AGPL-3.0, so this crate is too (`Cargo.toml`, [`LICENSE`](LICENSE)).

- **Offline batch runs** are always fine, on the desktop or rented machines (`cloud/`), and so is shipping their JSON output.
- **Live use** (turn and river solving on AWS Lambda) is allowed only as a **separate solver service**, under the conditions in [`docs/postflop-plan.md`](../docs/postflop-plan.md#agpl-conditions). In short:
  - its own process, reached only through JSON requests, never linked into the API or web app;
  - its source public under AGPL-3.0, with a link in the app to the deployed commit;
  - no database access or secrets;
  - a legal read before charging money.

## Setup on Windows (one time, about 15 minutes)

1. Install the **Visual Studio Build Tools** with the "Desktop development with C++" workload. Rust needs its linker. If the Rust installer offers to install it, accept.
2. Install Rust: download and run `rustup-init.exe` from <https://rustup.rs>, and accept the defaults.
3. Open a **new** terminal (PowerShell) so `cargo` is on your PATH, then:
   ```powershell
   cd path\to\GTOtutor\solver
   cargo build --release
   cargo test --release
   ```
   The test should print `test result: ok. 1 passed`.

## Run

Run all of these from `solver/`.

1. **Time one flop first:**
   ```powershell
   cargo run --release -- --flop Kh7d2c
   ```
   The first line prints the memory needed per solve: about 2.5 GB for the default spot, or 1.3 GB with `--compress`. The last line prints the solve time (about 15–20s on the desktop). To check a spot's memory without solving, add `--memory`.
2. **Start the batch with a 184-flop sample:**
   ```powershell
   cargo run --release -- --limit 184
   ```
   - Flops are solved in a fixed shuffled order, so any prefix is a representative random sample.
   - Ctrl+C stops it at any time. Run the same command again to resume; finished flops are skipped.
   - Every line shows an ETA.
3. **Keep the PC awake:** set Windows → Settings → Power → Sleep to "Never" while it runs.

## Watching progress

- **Terminal:** a live line shows the progress bar, the current flop, the iteration, the accuracy so far against the target, and the time on this flop. Each finished flop prints a line with an ETA.
- **From your phone or Mac:** add `--status-port 7878`:
  ```powershell
  cargo run --release -- --limit 184 --status-port 7878
  ```
  The solver prints a link like `http://192.168.x.x:7878`. Open it on any device on the same Wi-Fi; the page refreshes every 5 seconds. The first time, Windows asks whether to allow network access: allow it on **private networks** only. `/status.json` returns the same data as JSON.
- **File:** `output/<spot>/_progress.json` is updated about every 15 seconds, even without the status page.

Options are listed in `USAGE.txt` (`--accuracy`, `--threads`, `--compress`, `--flops <file>`, …).

## Long unattended runs

`run-queue.ps1` runs a list of solver jobs in order, one set of solver arguments per line, until a deadline. It keeps Windows awake while it runs, and nothing needs undoing afterwards. At the deadline it stops the current solve; the next run resumes from the finished flops.

```powershell
powershell -ExecutionPolicy Bypass -File run-queue.ps1 -Queue queue.txt -Until 09:00 -Log queue.log
```

- `keep-awake.ps1` only keeps the PC awake until a given time.
- `overnight.sh` is the 2026-10-05 pipeline: preflop calibration rounds, freezing the chart version, then flop solves.
- `cloud/` runs a queue on a rented EC2 Spot instance instead (about 4x the desktop per hour, paid from AWS credits). See [`cloud/README.md`](cloud/README.md).
- `apps/api/scripts/pickFlops.ts` writes a coverage-picked flop list for `--flops`.

## Live solver service

`live` solves one turn (and the river card the server has already dealt) per request.
- **Input:** the board, both ranges at the start of the turn, the pot, the stacks and the bet sizes (`src/live.rs`, `LiveRequest`).
- **Output:** every turn decision, plus every river decision for that river card, in the flop files' node format, gzipped. Each response carries the commit it was built from.
- **Statelessness:** it keeps no state and reads no files or secrets. The API builds the requests and keeps the cache.

```powershell
cargo build --release --features service      # builds live.exe as well
target\release\live.exe --serve 7879          # local development: POST /solve
cargo run --release --bin turn-bench -- --help  # see src/bin/turn-bench.rs: times trees a-e on a stored flop
```

On AWS it runs as the Lambda function `gtotutor-turn-solver`, built from `lambda/Dockerfile` (arm64). `cloud\lambda-deploy.ps1` deploys it and `cloud\lambda-test.ps1` times it; see `docs/deployment.md`. Turn solves take 0.2–5 s on 6 threads (`docs/postflop-plan.md`, Measured).

## Changing the spot

Spot files live in `spots/`. They are generated from the app's preflop charts:

```bash
npx tsx apps/api/scripts/exportSolverSpots.ts   # from the repo root
```

Each spot sets the two ranges, the pot, the stacks, and the bet and raise sizes per street: one of each on the flop, and one bet size with no raises on the turn and river (only the flop strategy is kept, and the raises cost 3x the time for almost no flop EV; see `docs/postflop-plan.md`). Every extra size makes each solve slower and use more memory. Re-export the spots whenever the preflop charts change, and re-solve into a fresh `--out` folder.

## Output format (`output/<spot>/<flop>.json`)

| Field | Meaning |
|---|---|
| `flop`, `weight` | Canonical flop, and how many of the 22,100 raw flops it stands for (suit-isomorphic) |
| `exploitability_pct_pot` | Accuracy reached; lower is closer to GTO |
| `hands[p]` | Player p's hands (0 = OOP / BB, 1 = IP / BTN) |
| `ev_bb[p]`, `equity[p]` | Per hand at the flop root |
| `tree` | Bet and raise sizes per street this flop was solved with (`""` = no raises) |
| `nodes[]` | Every flop decision: `history` (action indexes from the root), `player`, `actions`, `strategy[action][hand]` in permille, and per hand of `player`: `weights` (how much of the hand reaches this decision; 0 = never), `equity`, and `ev_bb[action][hand]` |

`output/` is gitignored. The API reads it directly (`SOLVER_OUTPUT_DIR` overrides the path): heads-up pots whose spot folder exists get real flop betting. Move results to the Mac with a zip or cloud drive for now; later they go to cloud storage.
