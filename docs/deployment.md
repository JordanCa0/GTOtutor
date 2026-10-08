# Deployment (AWS)

GTOtutor runs on AWS, with Supabase kept for sign-in and Postgres.

```
            Route 53 (<domain>)
                    │
              CloudFront ── ACM certificate (us-east-1)
             /          \
  default: S3 bucket     /api/*: api.<domain> → EC2
  (built web app)         ├─ Caddy (TLS) → API container (image from ECR)
                          └─ /data/solver-output ← synced from an S3 bucket
```

Why it's built this way:
- **The API runs on one always-on EC2 instance.** Live hands and coach rate limits are kept in memory (`HandService`, `LlmTeacher`), so Lambda or several instances would lose them.
  - A deploy restarts the process and drops hands in progress.
- **Flop files (`solver/output`, several GB) live in S3.** `deploy/deploy.sh` syncs them to the instance's disk, and `FlopStore` reads them there through `SOLVER_OUTPUT_DIR`.
- **CloudFront serves the web app and the API on one domain.** The web app keeps calling relative `/api/...`, so it needs no CORS setup.

Cost is about $10–15 a month: a t4g.small, an Elastic IP, and small amounts for S3, CloudFront and Route 53.

The files are in `deploy/` and `apps/api/Dockerfile`. Placeholders in angle brackets: `<domain>`, `<region>` (use `us-east-1`), `<account>`, `<solver-bucket>`, `<web-bucket>`.

## 1. Account safety (once)
1. Sign up on the **Free plan**. It gives $100–200 in credits for 6 months and can't bill you. Upgrade to the Paid plan before the 6 months end; leftover credits carry over.
2. Turn on MFA for the root user. After this step, don't use root again.
3. In IAM, create a user `jordan-admin` with console access, the `AdministratorAccess` policy, and its own MFA. Use this user from now on.
   - **Don't** use IAM Identity Center or AWS Organizations. Enabling them creates an Organization, which ends the new-account credits.
4. CLI: run `winget install Amazon.AWSCLI`, then `aws login` (signs in through the browser as `jordan-admin`). Check it with `aws sts get-caller-identity`. Every CLI command below uses this sign-in.
5. Billing → Budgets: create a monthly cost budget with email alerts at $10 and $25.

## 2. Flop files in S3
1. Create a private bucket `<solver-bucket>` in `<region>`, with Block Public Access left on.
2. Upload only the spots the server uses:
   ```sh
   aws s3 sync solver/output/btn_vs_bb_srp_100 s3://<solver-bucket>/solver-output/btn_vs_bb_srp_100
   # with PREFLOP_CHARTS=preflop-v8:
   aws s3 sync solver/output/preflop-v8 s3://<solver-bucket>/solver-output/preflop-v8
   ```

## 3. API image in ECR
1. Create a private repository named `gtotutor-api`.
2. Build and push the image from the repo root. It's ARM, to match t4g instances.
   ```sh
   aws ecr get-login-password --region <region> | docker login --username AWS --password-stdin <account>.dkr.ecr.<region>.amazonaws.com
   docker buildx build --platform linux/arm64 --provenance=false --sbom=false -f apps/api/Dockerfile -t <account>.dkr.ecr.<region>.amazonaws.com/gtotutor-api:latest --push .
   ```

## 4. Secrets in SSM Parameter Store
Create one **SecureString** parameter per variable under `/gtotutor/`. `deploy.sh` writes them to `app.env`, which the API container reads.

| Parameter | Value |
|---|---|
| `/gtotutor/ANTHROPIC_API_KEY` | API key. Also set a monthly spend limit in the Anthropic console. |
| `/gtotutor/DATABASE_URL` | Supabase **pooler** connection string |
| `/gtotutor/SUPABASE_URL` | `https://<project>.supabase.co` |
| `/gtotutor/SUPABASE_SERVICE_ROLE_KEY` | service role key |
| `/gtotutor/COACH_GLOBAL_LIMIT_PER_HOUR` | e.g. `200`: new coach answers per hour across everyone |
| `/gtotutor/CLAUDE_MODEL` | optional |
| `/gtotutor/PREFLOP_CHARTS` | optional: `/app/preflop/charts/preflop-v8.json` |

## 5. IAM role for the instance
1. Create a policy from `deploy/ec2-role-policy.json`. First replace `SOLVER_BUCKET`, `REGION` and `ACCOUNT_ID` in it. The policy only allows reading that bucket and those parameters, pulling that image, and writing its logs.
2. Create a role for the **EC2** service with:
   - that policy;
   - `AmazonSSMManagedInstanceCore`, so you get a shell through Session Manager without SSH keys.

## 6. EC2 instance
1. Launch an instance:
   - **t4g.small**, Amazon Linux 2023 (arm64), 20 GB gp3 disk;
   - the role from step 5;
   - no key pair.
2. Security group: allow inbound TCP 80 and 443 from anywhere. Caddy needs port 80 for its certificate. Leave port 22 closed.
3. Allocate an **Elastic IP** and associate it with the instance. Without it, the IP changes whenever the instance stops.
4. Connect with Session Manager (EC2 → Connect → Session Manager) and run:
   ```sh
   sudo bash bootstrap.sh   # paste deploy/bootstrap.sh in, or fetch it from the repo
   ```
5. Put `docker-compose.yml`, `Caddyfile` and `deploy.sh` in `/opt/gtotutor`. Copy `deploy.env.example` there as `deploy.env` and fill it in.
6. Point DNS at the instance (step 7.2) **before** the first run, so Caddy can get its certificate. Then:
   ```sh
   sudo bash /opt/gtotutor/deploy.sh
   ```
7. Check that `curl https://api.<domain>/api/health` returns `{"ok":true}`.

To deploy a new API version, push a new image (step 3) and run `deploy.sh` again.

## 7. Domain and certificates
1. In Route 53, register `<domain>` or create a hosted zone for it and point your registrar at the zone's name servers.
2. Add an A record `api.<domain>` → the Elastic IP.
3. In ACM, **in us-east-1** (CloudFront only uses certificates from there), request a certificate for `<domain>` and validate it with DNS. The "create records in Route 53" button does the validation for you.

## 8. Web app on S3 + CloudFront
1. Build with the public Supabase values. Only the publishable key goes here.
   ```sh
   VITE_SUPABASE_URL=... VITE_SUPABASE_ANON_KEY=... npm run build
   ```
2. Create a private bucket `<web-bucket>` and run `aws s3 sync apps/web/dist s3://<web-bucket> --delete`.
3. Create a CloudFront distribution:
   - **Origins:**
     - `<web-bucket>`, using Origin Access Control. Let CloudFront update the bucket policy.
     - `api.<domain>`, HTTPS only.
   - **Behaviors:**
     - **Default** → web bucket. Viewer: redirect HTTP to HTTPS.
     - **`/api/*`** → API origin, with:
       - allowed methods: all (GET, POST, DELETE, ...);
       - cache policy **CachingDisabled**;
       - origin request policy **AllViewerExceptHostHeader**. This forwards `Authorization`, `X-Guest-Id` and query strings.
   - **Error pages:** 403 and 404 → `/index.html` with status 200, so page refreshes work in the single-page app.
   - **Alternate domain:** `<domain>`, with the ACM certificate from step 7.3.
4. In Route 53, add an A record (alias) `<domain>` → the distribution.
5. To deploy a new web version: build, sync to the bucket, then run `aws cloudfront create-invalidation --distribution-id <id> --paths "/*"`.

## 9. Supabase and Google
1. Supabase → Auth → URL configuration:
   - Site URL `https://<domain>`;
   - add `https://<domain>/**` to the redirect URLs.
2. Google Cloud Console → OAuth client: add `https://<domain>` to the authorized JavaScript origins.
3. Run migrations against the production database: `DATABASE_URL=<prod> npm run db:migrate -w apps/api`.

## 10. Monitoring
- API logs go to the CloudWatch log group `/gtotutor/api`, through the `awslogs` driver in `docker-compose.yml`.
- In CloudWatch, set up alarms:
  - EC2 `StatusCheckFailed`. Use the "recover instance" action.
  - CPU over 80% for 15 minutes.
- On startup, the logs should **not** show the `DATABASE_URL is not set` or `SUPABASE_URL is not set` warnings.

## Checklist after a deploy
1. On `https://<domain>`, play a guest preflop hand, then a flop decision. The flop decision shows the S3 sync worked.
2. Open a coach explanation.
3. Sign in with Google and with email. Guest hands carry over.
4. Delete a test account.
5. Refresh a page that isn't the home page. It should load, not show an S3 error.

## Later
- **CI/CD:** a GitHub Actions workflow on pushes to `main`. It signs in to AWS through an IAM role over OIDC, so no long-lived keys are stored. It then:
  - pushes the image to ECR;
  - runs `aws ssm send-command` to execute `deploy.sh`;
  - syncs the web build to S3 and invalidates CloudFront.
- **Flop files:** have `FlopStore` read from S3 directly instead of syncing a copy to disk.
- **Infrastructure as code:** rebuild this setup in CDK or Terraform.
