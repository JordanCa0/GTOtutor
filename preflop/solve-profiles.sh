#!/usr/bin/env bash
# Solves a list of stack profiles (one per line, e.g. 100:UTG20:HJ60:CO60) into charts/<set>/,
# several at a time: the CFR loop runs on one core, so a 16-core desktop fits about 12.
# Profiles whose chart file already exists are skipped, so a stopped run picks up where it left off.
#
#   bash solve-profiles.sh <profiles.txt> [set=stacks-v1] [jobs=12]
#
# Uses the stacks-v1 settings: 1500 iterations and the calibrated realization file for each depth.
set -euo pipefail
cd "$(dirname "$0")"
list=$1
set=${2:-stacks-v1}
jobs=${3:-12}
mkdir -p "charts/$set" "logs/$set"
cargo build --release --quiet

solve() {
  local profile=$1 set=$2
  local name=${profile//:/-}
  local out="charts/$set/$name.json"
  [ -f "$out" ] && { echo "skip $profile"; return; }
  if ./target/release/gtotutor-preflop --stacks "$profile" --iterations 1500 \
    --realization 20=realization/stacks-20-r3.json \
    --realization 60=realization/stacks-60-r4.json \
    --realization 100=realization/v9-from-v9a-v9c.json \
    --version "$set-$name" --out "$out.tmp" >"logs/$set/$name.log" 2>&1; then
    mv "$out.tmp" "$out" && echo "done $profile"
  else
    echo "FAILED $profile (logs/$set/$name.log)"
  fi
}
export -f solve
grep -v '^\s*$' "$list" | xargs -P "$jobs" -I{} bash -c 'solve "$1" "$2"' _ {} "$set"
