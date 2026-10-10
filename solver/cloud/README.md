# Cloud solver runs (EC2)

Runs a solver queue on a rented EC2 instance instead of the desktop. It's the same solver and the same output files, just much faster: a 64-core instance does about 4 desktop-hours of solving per hour.

- **Spot by default.** Spare AWS capacity at roughly 50–70% off.
  - AWS can take a Spot instance back with 2 minutes' notice. The run copies finished flops to S3 every 5 minutes, and immediately when that notice comes, so re-launching resumes with little lost.
- **Never left running.** The instance powers off, and so deletes itself, when the queue finishes, when any setup step fails, or after `-MaxHours` (24 by default), whichever comes first.
- **Paid from AWS credits** while they last.
  - Rough cost: $0.01–0.02 per vCPU-hour on Spot, so about $1 per hour for 64 cores.
  - The rest of 100bb (`queue-cloud-preflop-v8.txt`, ~95 desktop-hours) is about $15–30.
- **License:** the AGPL solver may run on rented machines for offline batch work. It must never run on the app's server. Live turn and river solving runs as its own Lambda function instead (`lambda-deploy.ps1`, `lambda-test.ps1`; see `docs/deployment.md`, "Live turn and river solving").

```
desktop                         S3: gtotutor-solver-<account>/solver-runs/<version>/        EC2 Spot instance
launch.ps1  -- spots, queue --> spots/  queue.txt  output/ (partial)  --> builds solver from GitHub, 4 x 16 threads
status.ps1  <-- status.txt, logs/ ---------------------------------------- every 5 min (and on interruption)
fetch.ps1   <-- output/<version>/<spot>/<flop>.json ---------------------- then powers off = terminates
```

## One-time setup

1. **Sign in to the CLI:** `aws login`, as `jordan-admin`. Check with `aws sts get-caller-identity`.
2. **Raise the vCPU limit.** New accounts start low.
   1. Open **Service Quotas → AWS services → Amazon EC2**.
   2. Request **"All Standard (A, C, D, H, I, M, R, T, Z) Spot Instance Requests"** = **64**, or 128 for two instances' worth. Approval can take up to a day.
   3. For `-OnDemand` runs, the quota is **"Running On-Demand Standard (A, C, D, H, I, M, R, T, Z) instances"**.
3. **Create the role and security group** (from `solver/`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File cloud\setup.ps1
   ```
   - **Role `gtotutor-solver-runner`:** read/write on `solver-runs/` in the solver bucket only (`runner-policy.json`), plus Session Manager. The API server's role is separate and stays read-only.
   - **Security group `gtotutor-solver-sg`:** no inbound rules. The instance only reaches out, to GitHub and AWS.

## A run

From `solver/`:

```powershell
powershell -ExecutionPolicy Bypass -File cloud\launch.ps1                 # queue-cloud-preflop-v8.txt on a c7g.16xlarge Spot instance
powershell -ExecutionPolicy Bypass -File cloud\status.ps1                 # instance state, flops per spot, end of the log
powershell -ExecutionPolicy Bypass -File cloud\fetch.ps1                  # download solved flops into output/preflop-v8/
```

**`launch.ps1` options:**

| Option | Default | Notes |
|---|---|---|
| `-Queue` | `queue-cloud-preflop-v8.txt` | Same format as `run-queue.ps1` queues. Leave out `--status-port`, since several solvers share the machine. |
| `-Version` | `preflop-v8` | Chart version: the `spots/<version>/` and `output/<version>/` folders |
| `-InstanceType` | `c7g.16xlarge` | 64 Graviton cores. Alternatives: `c8g.16xlarge`, `c7a.16xlarge` (AMD), or `.8xlarge` (32 cores) if the quota is lower. |
| `-ThreadsPerWorker` | 16 | Solver processes = vCPUs ÷ this. Each solve needs at most ~2.2 GB of memory (`--memory`). |
| `-MaxHours` | 24 | Hard cap on the instance's life |
| `-OnDemand` | off | Never interrupted, at about 2–3× the price |
| `-Ref` | `main` | Git branch the instance builds the solver from |

**What happens:**
- `launch.ps1` uploads the spot files, the queue and any partial local output for queued spots, so those resume. It then starts the instance and refuses to start a second one while one is running.
- The instance installs Rust, clones the repo, and builds the solver (about 5 minutes). Then it splits the queue across its solver processes, each taking the next spot when it finishes one. The most played spots come first.
- `status.ps1` shows progress as soon as the build is done, refreshed every 5 minutes. `fetch.ps1` is safe to run at any time: it only downloads new flops and never deletes local ones.

**Two instances at once** (needs a 128-vCPU Spot quota):
- Split the queue so that **no spot appears in both halves**.
- Give each half its own `-Run` name, for example `-Run preflop-v9` and `-Run preflop-v9-b`.
- Each run gets its own S3 folder, status and DONE marker. Pass the same `-Run` to `status.ps1` and `fetch.ps1`.
- Both runs download into the same `output/<version>/`.

**If AWS reclaims the Spot instance:** `status.ps1` shows it terminated, without a "queue finished" line. Run `launch.ps1` again; finished flops are already in S3 and get skipped.

**If launching fails:**
- `InsufficientInstanceCapacity`: no Spot capacity for that type right now. Try another `-InstanceType`, or try again later.
- `MaxSpotInstanceCountExceeded` or `VcpuLimitExceeded`: the quota from setup step 2 is too low for that type. Request more, or use a smaller type.

**To look inside a running instance:** **EC2 → Instances → gtotutor-solver → Connect → Session Manager**. Useful places:
- `/var/log/solver-run.log`: the run's own log;
- `/opt/work/logs/worker-<n>.log`: each solver process's output;
- `/opt/work/output/`: solved flops.

## After a run
1. Run `fetch.ps1`. The flops land in `solver/output/<version>/`, next to the ones solved locally.
2. **Don't also run the same spots on the desktop while a cloud run has them.** That only wastes time: both write identical file names, so nothing breaks.
3. **Cleanup:** the instance is gone once it powers off. What stays in S3 under `solver-runs/` costs pennies a month; delete it when you no longer need it (`aws s3 rm s3://gtotutor-solver-<account>/solver-runs/<version> --recursive`).
4. **To publish flops to the live site:** follow "New flop solves" in `docs/deployment.md`, which uses the server's `solver-output/` prefix, not `solver-runs/`.

## Cost checks
- **Billing → Credits** shows what's left. The $10/$25 budget alerts still apply.
- **EC2 → Instances** should show no `gtotutor-solver` instance running after a run. The script makes sure of this, but it's the one thing to glance at.
