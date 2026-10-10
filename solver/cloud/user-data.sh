#!/bin/bash
# Startup script for a cloud solver instance (Amazon Linux 2023). launch.ps1 fills in the
# __PLACEHOLDERS__ and passes this as EC2 user data; it runs once, as root, at first boot.
#
# It builds the solver from GitHub, pulls the spots, queue and any partial output from S3, runs the
# queue with several solver processes at once, and copies finished flops back to S3 every few
# minutes (and right away when AWS announces a Spot interruption). When the queue is done, when a
# step fails, or after MAX_HOURS, it powers off; launch.ps1 sets shutdown to terminate the instance,
# so nothing is left running or billing.
set -euo pipefail

BUCKET=__BUCKET__
PREFIX=__PREFIX__
REPO=__REPO__
REF=__REF__
MAX_HOURS=__MAX_HOURS__
THREADS=__THREADS__
REGION=__REGION__

S3="s3://$BUCKET/$PREFIX"
LOG=/var/log/solver-run.log
WORK=/opt/work
export AWS_DEFAULT_REGION="$REGION" HOME=/root CARGO_HOME=/opt/cargo RUSTUP_HOME=/opt/rustup
export PATH="/opt/cargo/bin:$PATH"
exec > >(tee -a "$LOG") 2>&1

log() { echo "$(date -u +%FT%TZ) $*"; }
# Instance metadata (IMDSv2): a fresh token per call, since a run outlives any token.
imds() {
  local token
  token=$(curl -sf -X PUT http://169.254.169.254/latest/api/token -H 'X-aws-ec2-metadata-token-ttl-seconds: 300')
  curl -sf -H "X-aws-ec2-metadata-token: $token" "http://169.254.169.254/latest/meta-data/$1"
}
INSTANCE_ID=$(imds instance-id)
upload_log() { aws s3 cp "$LOG" "$S3/logs/$INSTANCE_ID.log" --quiet || true; }

# Flops solved per spot, so status.ps1 can show progress without downloading the output.
upload_status() {
  {
    echo "instance $INSTANCE_ID at $(date -u +%FT%TZ)"
    for d in "$WORK"/output/*/*/; do
      [ -d "$d" ] || continue
      echo "$(basename "$d") $(ls "$d" | grep -cE '^([2-9TJQKA][cdhs]){3}\.json$' || true)"
    done
  } > "$WORK/status.txt"
  aws s3 cp "$WORK/status.txt" "$S3/status.txt" --quiet || true
}

sync_up() {
  aws s3 sync "$WORK/output" "$S3/output" --quiet || log "sync failed (will retry)"
  upload_status
  upload_log
}

# Any failure before the end: save the log and power off rather than sit idle and bill.
trap 'log "failed at line $LINENO"; upload_log; shutdown -h now' ERR

log "solver run starting on $INSTANCE_ID ($(nproc) vCPUs), results to $S3"
# Hard cap, whatever happens: power off (= terminate) after MAX_HOURS.
shutdown -h "+$((MAX_HOURS * 60))"

dnf install -y -q gcc git util-linux
curl -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --no-modify-path
git clone --depth 1 --branch "$REF" "https://github.com/$REPO.git" /opt/src
log "building the solver"
(cd /opt/src/solver && cargo build --release --quiet)
BIN=/opt/src/solver/target/release/gtotutor-solver

mkdir -p "$WORK/logs"
cd "$WORK"
aws s3 sync "$S3/spots" spots --quiet
aws s3 sync "$S3/output" output --quiet
aws s3 cp "$S3/queue.txt" queue.txt --quiet
# Flop lists named by the queue (--flops), uploaded by launch.ps1.
aws s3 sync "$S3/inputs" . --quiet
# Strip carriage returns: a queue saved with Windows line endings would otherwise put one at the end
# of every --out path (a folder named "preflop-v8\r").
tr -d '\r' < queue.txt | grep -vE '^\s*(#|$)' > jobs.txt || true
echo 0 > next
WORKERS=$(( $(nproc) / THREADS ))
[ "$WORKERS" -ge 1 ] || WORKERS=1
log "$(wc -l < jobs.txt) jobs, $WORKERS workers x $THREADS threads"
upload_status

# Each worker takes the next queue line until none are left (flock keeps two from taking the same one).
worker() {
  local n=$1 job
  while true; do
    job=$({
      flock 9
      i=$(cat next)
      line=$(sed -n "$((i + 1))p" jobs.txt)
      [ -n "$line" ] && echo $((i + 1)) > next
      echo "$line"
    } 9> next.lock)
    [ -n "$job" ] || break
    log "worker $n: $job"
    # shellcheck disable=SC2086 # the queue line is the solver's argument list
    "$BIN" $job --threads "$THREADS" >> "logs/worker-$n.log" 2>&1 || log "worker $n: solver exited $? on: $job"
  done
  log "worker $n: queue empty"
}

# Copies results up every 5 minutes, and at once on a Spot interruption notice (2 minutes' warning).
syncer() {
  while true; do
    for _ in $(seq 60); do
      sleep 5
      if imds spot/instance-action > /dev/null; then
        log "spot interruption notice: final sync"
        sync_up
        sleep 300
      fi
    done
    sync_up
  done
}

# From here a failed solve shouldn't stop the run: workers log it and move on, and the end always
# syncs and powers off.
trap - ERR
set +e
syncer &
SYNCER=$!
pids=()
for n in $(seq "$WORKERS"); do
  worker "$n" &
  pids+=($!)
done
wait "${pids[@]}"
kill "$SYNCER" 2> /dev/null || true

sync_up
date -u +%FT%TZ | aws s3 cp - "$S3/DONE" --quiet
log "queue finished; powering off"
upload_log
shutdown -h now
