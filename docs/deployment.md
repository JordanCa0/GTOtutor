# Deployment (AWS)

GTOtutor runs on AWS, with Supabase kept for sign-in and Postgres.

```
            Route 53 (gtotutor.app)
                    │
              CloudFront ── ACM certificate (us-east-1)
             /          \
  default: S3 bucket     /api/*: api.gtotutor.app → EC2 (Elastic IP)
  (built web app)         ├─ Caddy (Let's Encrypt TLS) → API container (image from ECR)
                          └─ /data/solver-output ← synced from the solver S3 bucket
```

Why it's built this way:
- **The API runs on one always-on EC2 instance.** Live hands and coach rate limits are kept in memory (`HandService`, `LlmTeacher`), so Lambda or several instances would lose them.
  - Never run more than one instance.
  - Every deploy restarts the API and drops hands in progress.
- **Flop files (`solver/output`, several GB) live in S3.** `deploy/deploy.sh` syncs them to the instance's disk, and `FlopStore` reads them there through `SOLVER_OUTPUT_DIR`.
- **CloudFront serves the web app and the API on one domain.** The web app keeps calling relative `/api/...`, so it needs no CORS setup.
- **Secrets live only in SSM Parameter Store.** They never go in the repo or the image. `deploy.sh` writes them to `app.env` on the server.

Cost is about $10–15 a month: a t4g.small, an Elastic IP, and small amounts for S3, CloudFront and Route 53. The domain is billed yearly by its registrar.

The files are in `deploy/` and `apps/api/Dockerfile`.

## What's running

| Piece | Name | Notes |
|---|---|---|
| AWS account | `jordan-admin` IAM user | Free plan: upgrade to Paid before the 6 months end |
| Region | `us-east-1` | Everything; CloudFront certificates must be here |
| Domain | `gtotutor.app` | Bought outside AWS; name servers point at the Route 53 hosted zone |
| API | `https://api.gtotutor.app` | A record → Elastic IP of the `gtotutor-api` instance |
| Site | `https://gtotutor.app` | CloudFront; `www.gtotutor.app` too |
| EC2 | `gtotutor-api` | t4g.small (ARM), Amazon Linux 2023, 40 GB gp3 (grown from 20 on 2026-10-10 for the v9 flops), role `gtotutor-api-server` |
| Image | ECR `gtotutor-api:latest` | Keeps the last 5 images (`deploy/ecr-lifecycle.json`) |
| Flop files | `s3://gtotutor-solver-<account>/solver-output/` | `preflop-v9` flops for 48 spots, copied from `solver-runs/preflop-v9*/output/preflop-v9/` (~15 GB when complete). The placeholder-chart flops are archived in `solver-archive/fixture-v2/` |
| Web files | `s3://gtotutor-web-<account>/` | |
| Secrets | SSM `/gtotutor/*` | See step 4 |
| Logs | CloudWatch `/gtotutor/api` | |
| Server folder | `/opt/gtotutor` | `deploy.env`, `.env` → `deploy.env`, `app.env` (secrets), compose files |

`<account>` is the AWS account ID. Get it with `aws sts get-caller-identity`.

## Updating production

| What changed | Do this |
|---|---|
| API code (`apps/api`, `packages/shared-types`) | Push a new image, then run `deploy.sh` |
| Web app (`apps/web`) | Build, sync to the web bucket, invalidate `index.html` |
| New flop solves | Sync them to the solver bucket, then run `deploy.sh` |
| Settings or secrets | Change them in Parameter Store, then run `deploy.sh` |
| Database schema | Migrate first, then deploy the API |
| Deploy files (`deploy/*`) | Push to GitHub, download them again on the server, then run `deploy.sh` |
| Turn/river solver (`solver/src`) | Commit and push, then run `solver\cloud\lambda-deploy.ps1` (see "Live turn and river solving") |

**The order matters.** When a change touches both sides: migrate the database, then deploy the API, then the web app. A new API with the old web page usually works; a new web page calling an old API often doesn't.

### API code
On your PC (Docker Desktop running):
```powershell
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker buildx build --platform linux/arm64 --provenance=false --sbom=false -f apps/api/Dockerfile -t <account>.dkr.ecr.us-east-1.amazonaws.com/gtotutor-api:latest --push .
```
On the server (EC2 → `gtotutor-api` → Connect → Session Manager):
```sh
sudo bash /opt/gtotutor/deploy.sh
```
`deploy.sh` does the following, and is safe to run any time:
1. Syncs the flop files.
2. Rewrites `app.env` from Parameter Store.
3. Pulls the image.
4. Restarts the API.

### Web app
```powershell
npm run build
aws s3 sync apps/web/dist s3://gtotutor-web-<account> --delete
aws cloudfront create-invalidation --distribution-id <id> --paths "/index.html"
```
- `npm run build` picks up `apps/web/.env.local` (Supabase URL and publishable key) by itself.
- Vite gives JS and CSS files new names on every build, so only `index.html` needs clearing from CloudFront's cache.

### New flop solves
```powershell
aws s3 sync solver/output/<spot> s3://gtotutor-solver-<account>/solver-output/<spot>
```
Then run `deploy.sh` on the server. Only new or changed files download, and the restart makes the API pick them up (it caches the list of solved flops).

### Solved preflop charts
To turn on `preflop-v8`, or move to a later version:
1. Upload the matching flop folder: `solver/output/<version>/` → `solver-output/<version>/`. The flop files must come from the same charts.
2. Set `/gtotutor/PREFLOP_CHARTS` to `/app/preflop/charts/<version>.json`.
3. For a chart file not yet in the image, add it to the `COPY preflop/charts/...` line in `apps/api/Dockerfile` and push a new image. Today only `preflop-v8.json` is in it.
4. Run `deploy.sh`.

Placeholders stay the default until the solved charts are reviewed (see CLAUDE.md).

### Settings and secrets
1. Change the value in **Systems Manager → Parameter Store**. Enter secrets in the console, not the CLI, so they don't land in PowerShell's history.
2. Run `deploy.sh`.

### Database schema
1. Run `npm run db:migrate -w apps/api` with `DATABASE_URL` pointing at production.
2. Then deploy the API.

Keep migrations additive (new columns or tables) so the running API keeps working until the new one is live. Rename or drop columns in a later release.

### Deploy files
After changing `deploy/docker-compose.yml`, `deploy.sh` or `Caddyfile`, push to GitHub, then on the server:
```sh
cd /opt/gtotutor
for f in docker-compose.yml Caddyfile deploy.sh; do curl -fsSLO https://raw.githubusercontent.com/JordanCa0/GTOtutor/main/deploy/$f; done
bash deploy.sh
```
GitHub can serve the old copy for a few minutes after a push. Check with `grep` that the change arrived before running `deploy.sh`.

### Live turn and river solving
The turn and river are solved live by the Lambda function `gtotutor-turn-solver`. It's a separate AGPL-3.0 program built from `solver/` (`docs/postflop-plan.md`). The API invokes it and keeps the results in `s3://gtotutor-solver-<account>/turn-cache/`.

**Deploy or update the function** (on your PC with Docker Desktop running, from `solver/`):
```powershell
powershell -ExecutionPolicy Bypass -File cloud\lambda-deploy.ps1
```
- It deploys only a commit that is pushed to GitHub with no local changes in `solver/`. The app links to that commit's source, as the license requires.
- It creates what's missing:
  - the ECR repository `gtotutor-turn-solver`;
  - the role `gtotutor-turn-solver` (logs only);
  - the function: arm64, 10 GB memory for 6 vCPUs, 30 s timeout, no URL.
- Time it with a saved request: `cloud\lambda-test.ps1 -Request <file>`. The script's header shows how to make one.

**Turn it on** (first time):
1. Add the `TurnSolveCache` and `InvokeTurnSolver` statements from `deploy/ec2-role-policy.json` to the `gtotutor-api-server` policy.
2. Set `TURN_SOLVER_LAMBDA` and `TURN_CACHE_BUCKET` in Parameter Store (step 4).
3. Push an API image with live solving, then run `deploy.sh`.
4. Check that the API log says "live turn and river solving is on". Play a flop-practice hand to the turn.

**Turn it off:** delete `/gtotutor/TURN_SOLVER_LAMBDA` and run `deploy.sh`. Hands run out after the flop, as before.

**Capacity:**
- The account allows 10 Lambda runs at once (a new-account default). That's about 3 players reaching the turn at the same moment.
- Ask for more in **Service Quotas → AWS Lambda → Concurrent executions**.
- Once the limit is 110 or more, `lambda-deploy.ps1` also caps this function at 10 runs, to bound cost.

### Useful commands on the server
```sh
cd /opt/gtotutor
docker compose ps                          # both containers "Up"?
docker compose logs api --tail 50          # API log
docker compose logs caddy --tail 50        # TLS/proxy log
docker compose logs api | grep -i "not set"   # should print nothing
docker compose restart api                 # restart without redeploying
```

## First-time setup

### 1. Account safety
1. Sign up on the **Free plan**. It gives $100–200 in credits for 6 months and can't bill you. Upgrade to the Paid plan before the 6 months end; leftover credits carry over, but the account closes if you don't.
2. Turn on MFA for the root user. After this step, use root only for root-only tasks:
   - turning on IAM access to Billing;
   - upgrading the plan;
   - changing the account email;
   - closing the account.
3. In IAM, create a user `jordan-admin` with console access, the `AdministratorAccess` policy, and its own MFA. Use this user from now on.
   - Choose "I want to create an IAM user", not Identity Center.
   - **Don't** use IAM Identity Center or AWS Organizations. Enabling them creates an Organization, which ends the new-account credits.
4. CLI:
   1. Run `winget install Amazon.AWSCLI`, then open a **new** terminal (old ones don't see it).
   2. Run `aws configure set region us-east-1`.
   3. Run `aws login`, which signs in through the browser as `jordan-admin`.
   4. Check with `aws sts get-caller-identity`.
5. Billing → Budgets: create monthly cost budgets with email alerts at $10 and $25.

### 2. Flop files in S3
```powershell
aws s3 mb s3://gtotutor-solver-<account> --region us-east-1
aws s3 sync solver/output/btn_vs_bb_srp_100 s3://gtotutor-solver-<account>/solver-output/btn_vs_bb_srp_100
```
New buckets block public access by default; leave it that way.

### 3. API image in ECR
```powershell
aws ecr create-repository --repository-name gtotutor-api --image-scanning-configuration scanOnPush=true --region us-east-1
aws ecr put-lifecycle-policy --repository-name gtotutor-api --region us-east-1 --lifecycle-policy-text file://deploy/ecr-lifecycle.json
```
Then build and push the image as in [API code](#api-code).
- It's built for ARM to match t4g instances. On an Intel PC, Docker emulates ARM, which is slower.
- `--provenance=false --sbom=false` keeps each push to one image. Without them, every push adds untagged extras that use up the lifecycle rule's 5 slots.

### 4. Secrets in SSM Parameter Store
Create one parameter per variable under `/gtotutor/`, using the Standard tier (free).

| Parameter | Type | Value |
|---|---|---|
| `/gtotutor/ANTHROPIC_API_KEY` | SecureString | A production-only key with a monthly spend limit set in the Anthropic console |
| `/gtotutor/DATABASE_URL` | SecureString | Supabase **session pooler** URI (`aws-0-us-east-1.pooler.supabase.com:5432`). The direct database host is IPv6-only and EC2 is IPv4. |
| `/gtotutor/SUPABASE_URL` | SecureString | `https://<project>.supabase.co` |
| `/gtotutor/SUPABASE_SERVICE_ROLE_KEY` | SecureString | Service role key |
| `/gtotutor/COACH_GLOBAL_LIMIT_PER_HOUR` | String | `200`: new coach answers per hour across all players |
| `/gtotutor/CLAUDE_MODEL` | String | Optional |
| `/gtotutor/PREFLOP_CHARTS` | String | `/app/preflop/charts/preflop-v9.json` (on since 2026-10-10; leave it out for the placeholder charts) |
| `/gtotutor/TURN_SOLVER_LAMBDA` | String | `gtotutor-turn-solver`: turns on live turn and river solving. Leave it out and hands run out after the flop. |
| `/gtotutor/TURN_CACHE_BUCKET` | String | `gtotutor-solver-<account>`: where solves are cached (`turn-cache/`) |
| `/gtotutor/LIVE_SOLVES_PER_HOUR` | String | Optional, default 300: uncached turn solves per player per hour |
| `/gtotutor/LIVE_SOLVES_GLOBAL_PER_HOUR` | String | Optional, default 3000: the same, for all players together |

To list the names (no values): `aws ssm get-parameters-by-path --path /gtotutor/ --query 'Parameters[].Name'`.

### 5. IAM role for the instance
1. Create the policy `gtotutor-api-server` (IAM → Policies → JSON) from `deploy/ec2-role-policy.json`, replacing `SOLVER_BUCKET`, `REGION` and `ACCOUNT_ID`. It allows only:
   - reading `solver-output/` in the solver bucket;
   - reading and writing `turn-cache/` there (live turn solves);
   - invoking the `gtotutor-turn-solver` function;
   - reading `/gtotutor*` parameters;
   - pulling `gtotutor-api`;
   - writing `/gtotutor/*` logs.
2. Create the role `gtotutor-api-server` (IAM → Roles → AWS service → EC2) with:
   - that policy;
   - `AmazonSSMManagedInstanceCore`, for Session Manager access.

   Creating it in the console also creates the instance profile EC2 needs.

### 6. EC2 instance
1. Launch `gtotutor-api` with these settings:

   | Setting | Value |
   |---|---|
   | AMI | Amazon Linux 2023, **64-bit (Arm)**. The x86 build won't run the ARM image. |
   | Instance type | **t4g.small** |
   | Key pair | None |
   | Public IP | Auto-assign |
   | Security group | `gtotutor-api-sg`: **80 and 443** from anywhere. Remove the SSH rule. |
   | Storage | 20 GiB gp3, **encrypted** (Advanced → Encrypted, key `aws/ebs`) |
   | IAM instance profile | `gtotutor-api-server` |
   | Metadata | IMDSv2 required |
   | Credit specification | **Standard**, so there are no surprise CPU charges |
2. Check the preview shows `t4g.small` and `"Encrypted":true` before launching.
3. EC2 → Elastic IPs → Allocate, then Associate it with the instance.
4. Point `api.gtotutor.app` at the Elastic IP (step 7) **before** the first deploy, so Caddy can get its certificate.
5. In Session Manager:
   ```sh
   sudo -i
   cd /tmp && curl -fsSLO https://raw.githubusercontent.com/JordanCa0/GTOtutor/main/deploy/bootstrap.sh
   bash bootstrap.sh
   cd /opt/gtotutor
   for f in docker-compose.yml Caddyfile deploy.sh deploy.env.example; do curl -fsSLO https://raw.githubusercontent.com/JordanCa0/GTOtutor/main/deploy/$f; done
   cp deploy.env.example deploy.env && nano deploy.env   # fill in account, image, API_DOMAIN=api.gtotutor.app, bucket
   bash deploy.sh
   ```
6. Check that `curl https://api.gtotutor.app/api/health` returns `{"ok":true}`.

### 7. Domain and DNS
1. Buy the domain. A Free-plan account couldn't register one in Route 53, so `gtotutor.app` was bought elsewhere.
2. Route 53 → Create hosted zone `gtotutor.app`, then set the registrar's name servers to the zone's 4 NS values.
3. Add an A record `api` → the Elastic IP, with TTL 300.
4. Check with `Resolve-DnsName api.gtotutor.app -Server 1.1.1.1`.

### 8. Web app on S3 + CloudFront
1. **Certificate:** in ACM (**us-east-1**), request a public certificate for `gtotutor.app` and `www.gtotutor.app` with DNS validation. Click **Create records in Route 53**, then wait for **Issued**.
2. **Bucket and files:**
   ```powershell
   aws s3 mb s3://gtotutor-web-<account> --region us-east-1
   npm run build
   aws s3 sync apps/web/dist s3://gtotutor-web-<account> --delete
   ```
3. **CloudFront distribution:**
   - If CloudFront asks for a pricing plan, the Free flat-rate plan covers this traffic.
   - **Origins:**
     - the web bucket, with **Origin access control**. Let CloudFront update the bucket policy; the bucket stays private.
     - `api.gtotutor.app`, HTTPS only.
   - **Behaviors:**
     - **Default** → web bucket: redirect HTTP to HTTPS, **CachingOptimized**.
     - **`/api/*`** → API origin:
       - redirect HTTP to HTTPS;
       - all methods;
       - **CachingDisabled**;
       - origin request policy **AllViewerExceptHostHeader**. This forwards `Authorization`, `X-Guest-Id` and query strings, while Caddy still sees its own host name.
   - **Alternate domains:** `gtotutor.app` and `www.gtotutor.app`, with the certificate from step 8.1.
   - **Default root object:** `index.html`.
   - Add **no** custom error pages. They apply to `/api/*` too and would turn API 404s into the web page. The app has no client-side routes, and every sign-in redirect returns to `/`.
4. **DNS:** in Route 53, add A records **Alias → the distribution** for `gtotutor.app` (blank name) and `www`.
5. **Check:** `https://gtotutor.app` loads, and `https://gtotutor.app/api/health` returns `{"ok":true}`.

### 9. Supabase and Google
1. Supabase → Auth → URL configuration:
   - Site URL `https://gtotutor.app`;
   - add `https://gtotutor.app/**` and `https://www.gtotutor.app/**` to the redirect URLs.
2. Google Cloud Console → OAuth client: add `https://gtotutor.app` and `https://www.gtotutor.app` to the authorized JavaScript origins.
3. Run `npm run db:migrate -w apps/api` against the production `DATABASE_URL`.

### 10. Monitoring
- API logs go to CloudWatch `/gtotutor/api`, through the `awslogs` driver. Keep them 30 days, as the privacy policy says: `aws logs put-retention-policy --log-group-name /gtotutor/api --retention-in-days 30 --region us-east-1`.
- Set up CloudWatch alarms:
  - EC2 `StatusCheckFailed`, with the "recover instance" action;
  - CPU over 80% for 15 minutes.

## Checklist after a deploy
1. On `https://gtotutor.app`, play a guest preflop hand, then a flop decision. The flop decision shows the flop files are in place.
2. Open a coach explanation.
3. Sign in with Google and with email. Guest hands carry over.
4. Delete a test account.
5. `https://gtotutor.app/api/nope` returns a JSON 404 from the API, not the web page.

## Problems we hit
| Symptom | Cause and fix |
|---|---|
| Region menu shows "Global" and can't be changed | That page is a global service (IAM, Billing). Open S3 or EC2 to pick a region. |
| `aws` not recognized | The terminal was opened before the install. Open a new terminal; restart your editor if the terminal is inside it. |
| `Unknown options` on a CLI command with JSON | PowerShell 5.1 breaks quoted JSON. Put the JSON in a file and pass `file://path.json`. |
| Untagged `None` images in ECR after a push | buildx attestations. Build with `--provenance=false --sbom=false`. Delete leftovers with `list-images --filter tagStatus=UNTAGGED` + `batch-delete-image`, running it twice if an index still referenced a manifest. |
| `exec format error` (avoided) | x86 AMI or instance type with the ARM image. Use a 64-bit (Arm) AMI with t4g. |
| `docker compose` says `API_IMAGE` is not set | Compose reads `.env` for those variables. `deploy.sh` links `.env` → `deploy.env`; until then, add `--env-file deploy.env`. |
| Docker Desktop: hardware virtualization is off | Enable Intel VMX in the BIOS (ASUS: F7 → Advanced → CPU Configuration), then run `wsl --install` from an admin PowerShell. |
| Route 53 domain registration failed | Free-plan limit. Buy the domain elsewhere and point it at a Route 53 hosted zone. |
| API log full of 404s for `/.well-known/...`, `/` | Internet scanners. Harmless. |

## Later
- **`deploy/release.ps1`:** one command on your PC that builds and pushes the image, uploads the web app, invalidates CloudFront, and runs `deploy.sh` through `aws ssm send-command` (the role already allows Session Manager).
- **CI/CD:** a GitHub Actions workflow on pushes to `main`, signing in to AWS through an IAM role over OIDC so no long-lived keys are stored.
- **Smaller image:** a production-only install without dev tools; `tsx` is the only one needed at runtime.
- **Flop files:** have `FlopStore` read from S3 directly instead of syncing a copy to disk.
- **Infrastructure as code:** rebuild this setup in CDK or Terraform.
