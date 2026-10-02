# GTOtutor

A browser poker trainer: play preflop spots, get a verdict against range charts, and learn from a Claude-powered coach. Flop decisions are played and graded from offline solver output for spots that have it; turn and river still run out automatically. See `docs/postflop-plan.md`.

## Layout

- `apps/api`: Fastify + TypeScript.
  - Hand engine, charts, Claude coach (`src/teacher/`).
  - Flop play: `src/postflop/` loads `solver/output/<spot>/` and maps any flop to the nearest solved one.
  - Tests use vitest.
- `apps/web`: Vite + React 19.
- `packages/shared-types`: types shared by the API and the web app.
- `solver/`: Rust batch flop solver.
  - Offline only, because of the AGPL license.
  - See `solver/README.md`.

## Commands (repo root)

- `npm run dev` starts both servers: web on :5173, API on :3001.
- `npm test`, `npm run typecheck`, `npm run build`.
- `npx tsx apps/api/scripts/exportSolverSpots.ts` regenerates `solver/spots/*.json` from the charts.
- `npx tsx apps/api/scripts/nearestFlopTest.ts` and `compareSolves.ts` measure flop-mapping and tree accuracy.

## Rules

- **Never** add Claude co-author or "Generated with Claude" lines to commits or PRs.
- The Anthropic API key lives only in `apps/api/.env`, which is gitignored. Never commit it or print it.
- Commit and push only when asked.
- Charts are placeholders (`fixture-v2`) until the preflop solver lands. Preflop UI copy says "chart", not "solver". Flop strategies are real solver output (computed from the placeholder ranges), so flop copy may say "solver".
