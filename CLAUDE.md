# GTOtutor

A browser poker trainer: play preflop spots, get a verdict against range charts, and learn from a Claude-powered coach. Flop decisions are played and graded from offline solver output for spots that have it; turn and river still run out automatically. See `docs/postflop-plan.md`.

20bb and 60bb (equal and mixed stacks) are planned in `docs/stack-depths-plan.md`.

Ideas planned for later (opponent archetypes, heads-up exploit mode, player style chart, glossary and beginner section, hand replayer, mobile layout) are in `docs/future-ideas.md`.

Accounts and a database run on Supabase: sign-in with Google only, guest play that carries over on sign-up, and every hand and decision saved in Postgres. Saved coach chats, stars/tags, and "My hands" are next. Solver data lives in S3, not Supabase (see Hosting below). See `docs/accounts-and-data.md` and `docs/database-schema.md`.

Hosting is on AWS: web on S3 + CloudFront, the API in Docker on one EC2 instance (it keeps live hands in memory, so never more than one), flop files synced from S3. Runbook in `docs/deployment.md`; files in `deploy/` and `apps/api/Dockerfile`.

## Layout

- `apps/api`: Fastify + TypeScript.
  - Hand engine, charts, Claude coach (`src/teacher/`).
  - Flop play: `src/postflop/` loads `solver/output/<spot>/` and maps any flop to the nearest solved one.
  - Data: `src/db/` (Drizzle schema, migrations in `drizzle/`, `Repo` with Postgres and in-memory versions); `src/engine/handService.ts` saves hands; `src/auth/` resolves the player (Supabase token or `X-Guest-Id`).
  - Tests use vitest.
- `apps/web`: Vite + React 19. Sign-in lives in `src/auth/` and `src/components/AccountMenu.tsx`.
- `packages/shared-types`: types shared by the API and the web app.
- `solver/`: Rust batch flop solver.
  - Offline only, because of the AGPL license.
  - See `solver/README.md`.
- `preflop/`: Rust preflop solver (our own code, not AGPL).
  - Writes `preflop/charts/<version>.json`. The API loads it with `PREFLOP_CHARTS=<file>`, otherwise it uses the placeholders.
  - See `preflop/README.md`.

## Commands (repo root)

- `npm run dev` starts both servers: web on :5173, API on :3001.
- `npm test`, `npm run typecheck`, `npm run build`.
- `npx tsx apps/api/scripts/exportSolverSpots.ts` regenerates `solver/spots/*.json` from the placeholder charts.
  - Add `--charts preflop/charts/<version>.json` to write `solver/spots/<version>/` instead.
  - Solve those into `solver/output/<version>/` so solves from different charts never mix.
- Flop accuracy scripts:
  - `flopEvLoss.ts`: mapping EV loss, % of pot.
  - `compareSolves.ts`: tree and solve-accuracy loss.
  - `nearestFlopTest.ts`: strategy difference.
- Preflop scripts:
  - `calibrateRealization.ts`: realization factors from flop solves.
  - `compareCharts.ts`: diff two chart versions.
  - `spotFrequency.ts`: how often each flop spot comes up.
  - `pickFlops.ts`: coverage-picked flop lists for `--flops`.
- Database: change `apps/api/src/db/schema.ts`, then `npm run db:generate -w apps/api`, review the SQL in `apps/api/drizzle/`, then `npm run db:migrate -w apps/api`. Update `docs/database-schema.md` to match.
- `RUN_DB_TESTS=1 npx vitest run test/persistence.test.ts` (in `apps/api`) runs the storage tests against Supabase too.

## Rules

- **Never** add Claude co-author or "Generated with Claude" lines to commits or PRs.
- The Anthropic API key lives only in `apps/api/.env`, which is gitignored. Never commit it or print it. The same goes for `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; only the publishable key may reach the web app (`apps/web/.env.local`).
- Only the API reads or writes the database (RLS is on with no policies). Every route that touches player data must check the data belongs to the requesting player.
- Guest data lasts one session; signed-in data is kept until the account is deleted.
- Commit and push only when asked.
- The app's default charts are still placeholders (`fixture-v2`). Solved charts (`preflop/charts/`) are opt-in through `PREFLOP_CHARTS` until they're reviewed.
  - Preflop UI copy says "chart", not "solver".
  - Flop strategies are real solver output (computed from the placeholder ranges, or the solved ones under `solver/output/<version>/`), so flop copy may say "solver".
