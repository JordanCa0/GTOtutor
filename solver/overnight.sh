#!/usr/bin/env bash
# Overnight pipeline (2026-10-05): finish calibration, freeze the preflop charts, then solve flops
# until 09:00. Each step logs to solver/overnight.log. Safe to re-run: every step skips work that's
# already done (charts that exist, flops already solved).
set -uo pipefail # no -e: a failed step is logged and the night carries on
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
LOG="$ROOT/solver/overnight.log"
say() { echo "$(date +%H:%M:%S) $*" | tee -a "$LOG"; }
queue() { # queue file, log name
  (cd solver && powershell -NoProfile -ExecutionPolicy Bypass -File run-queue.ps1 -Queue "$1" -Until 09:00 -Log "$2") >> "$LOG" 2>&1
}
calib_spots() { # version -> spot dirs used for calibration
  for s in btn_vs_bb_4bp_100 sb_vs_bb_4bp_100 btn_vs_bb_3bp_100 co_vs_btn_3bp_100 sb_vs_bb_srp_100 co_vs_bb_srp_100 btn_vs_bb_srp_100 sb_vs_bb_iso_100 sb_vs_bb_limp_100; do
    echo "solver/output/$1/$s"
  done
}
calib_queue() { # version -> queue file
  local v=$1 f="solver/queue-calib-$1.txt"
  {
    echo "# Calibration: a random flop sample per pot type, on charts $v."
    for s in btn_vs_bb_4bp_100 sb_vs_bb_4bp_100 btn_vs_bb_3bp_100 co_vs_btn_3bp_100 sb_vs_bb_srp_100 co_vs_bb_srp_100 btn_vs_bb_srp_100; do echo "--spot spots/$v/$s.json --out output/$v --limit 60"; done
    for s in sb_vs_bb_iso_100 sb_vs_bb_limp_100; do echo "--spot spots/$v/$s.json --out output/$v --limit 40"; done
  } > "$f"
  echo "queue-calib-$v.txt"
}
# Calibrate from version $1's flop solves, solve version $2, export its spots, compare.
next_charts() {
  local from=$1 to=$2 r="preflop/realization/from-$1.json"
  # shellcheck disable=SC2046
  npx tsx apps/api/scripts/calibrateRealization.ts "$r" $(calib_spots "$from") >> "$LOG" 2>&1
  if [ ! -f "preflop/charts/$to.json" ]; then
    (cd preflop && ./target/release/gtotutor-preflop.exe --iterations 1500 --version "$to" --realization "realization/from-$from.json") >> "$LOG" 2>&1
  fi
  npx tsx apps/api/scripts/exportSolverSpots.ts --charts "preflop/charts/$to.json" >> "$LOG" 2>&1
  npx tsx apps/api/scripts/compareCharts.ts "preflop/charts/$from.json" "preflop/charts/$to.json" > "preflop/compare-$from-$to.txt" 2>&1
  cat "preflop/compare-$from-$to.txt" >> "$LOG"
}
changed_pct() { # compare file -> weighted % of decisions that changed
  grep -o 'comes up: [0-9.]*%' "$1" | grep -o '[0-9.]*' || echo 100
}

say "waiting for calibration round 1 (charts preflop-v2)"
until grep -aq "queue done" <(iconv -f UTF-16 -t UTF-8 solver/queue-calib-v2.log 2>/dev/null || cat solver/queue-calib-v2.log); do sleep 30; done
say "round 1 done; extra role spots"
queue queue-calib-v2b.txt queue-calib-v2b.log
say "-> preflop-v3"
next_charts preflop-v2 preflop-v3
FINAL=preflop-v2
[ -f preflop/charts/preflop-v3.json ] && FINAL=preflop-v3 || say "ERROR: preflop-v3 wasn't written; staying on preflop-v2"
pct=$(changed_pct preflop/compare-preflop-v2-preflop-v3.txt)
say "v2 -> v3: $pct% of decisions changed"
if [ "$FINAL" = preflop-v3 ] && awk "BEGIN { exit !($pct > 3) }"; then
  say "still moving: calibration round 2 on preflop-v3"
  queue "$(calib_queue preflop-v3)" queue-calib-preflop-v3.log
  next_charts preflop-v3 preflop-v4
  [ -f preflop/charts/preflop-v4.json ] && FINAL=preflop-v4 || say "ERROR: preflop-v4 wasn't written; staying on preflop-v3"
  say "v3 -> v4: $(changed_pct preflop/compare-preflop-v3-preflop-v4.txt)% of decisions changed"
fi
say "frozen: $FINAL"
echo "$FINAL" > preflop/charts/FROZEN

# Flop solving on the frozen charts. First a coverage-picked sample for the most-played spots, so
# each gets flop play; then every flop for the two biggest single-raised pots, in the solver's fixed
# random order, until 09:00.
npx tsx apps/api/scripts/pickFlops.ts 150 solver/flops-150.txt >> "$LOG" 2>&1
Q="solver/queue-$FINAL.txt"
{
  echo "# Flop solves on frozen charts $FINAL."
  for s in btn_vs_bb_srp_100 co_vs_bb_srp_100 sb_vs_bb_limp_100 hj_vs_bb_srp_100 utg_vs_bb_srp_100; do
    echo "--spot spots/$FINAL/$s.json --out output/$FINAL --flops flops-150.txt"
  done
  echo "--spot spots/$FINAL/btn_vs_bb_srp_100.json --out output/$FINAL"
  echo "--spot spots/$FINAL/co_vs_bb_srp_100.json --out output/$FINAL"
} > "$Q"
say "flop queue $Q"
queue "queue-$FINAL.txt" "queue-$FINAL.log"
say "overnight pipeline finished"
