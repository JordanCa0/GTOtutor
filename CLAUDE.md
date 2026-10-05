# GTOtutor

A browser poker trainer: play preflop spots, get a verdict against range charts, and learn from a Claude-powered coach. Flop decisions are played and graded from offline solver output for spots that have it; turn and river still run out automatically. See `docs/postflop-plan.md`.

Accounts and a database run on Supabase: sign-in (Google, email + password), guest play that carries over on sign-up, and every hand and decision saved in Postgres. Saved coach chats, stars/tags, "My hands", and solver data in Storage are next. See `docs/accounts-and-data.md` and `docs/database-schema.md`.

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

## Commands (repo root)

- `npm run dev` starts both servers: web on :5173, API on :3001.
- `npm test`, `npm run typecheck`, `npm run build`.
- `npx tsx apps/api/scripts/exportSolverSpots.ts` regenerates `solver/spots/*.json` from the charts.
- `npx tsx apps/api/scripts/nearestFlopTest.ts` and `compareSolves.ts` measure flop-mapping and tree accuracy.
- Database: change `apps/api/src/db/schema.ts`, then `npm run db:generate -w apps/api`, review the SQL in `apps/api/drizzle/`, then `npm run db:migrate -w apps/api`. Update `docs/database-schema.md` to match.
- `RUN_DB_TESTS=1 npx vitest run test/persistence.test.ts` (in `apps/api`) runs the storage tests against Supabase too.

## Rules

- **Never** add Claude co-author or "Generated with Claude" lines to commits or PRs.
- The Anthropic API key lives only in `apps/api/.env`, which is gitignored. Never commit it or print it. The same goes for `DATABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`; only the publishable key may reach the web app (`apps/web/.env.local`).
- Only the API reads or writes the database (RLS is on with no policies). Every route that touches player data must check the data belongs to the requesting player.
- Guest data lasts one session; signed-in data is kept until the account is deleted.
- Commit and push only when asked.
- Charts are placeholders (`fixture-v2`) until the preflop solver lands. Preflop UI copy says "chart", not "solver". Flop strategies are real solver output (computed from the placeholder ranges), so flop copy may say "solver".
