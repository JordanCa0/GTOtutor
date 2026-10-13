import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
import { ArchetypeService } from './archetypes/archetypeService.js';
import { jevFromEnv } from './archetypes/jevClient.js';
import { supabaseAccountAdmin } from './auth/accounts.js';
import { PlayerResolver } from './auth/player.js';
import { supabaseVerifier } from './auth/verify.js';
import { ChartService } from './charts/chartService.js';
import { chartsFromEnv } from './charts/solvedCharts.js';
import { createDb, PgRepo } from './db/pgRepo.js';
import { MemoryRepo, type Repo } from './db/repo.js';
import { HandEngine } from './engine/handEngine.js';
import { HandService } from './engine/handService.js';
import { runoutResolver } from './engine/showdownResolver.js';
import { FlopStore } from './postflop/flopStore.js';
import { liveSolverFromEnv } from './postflop/liveSolver.js';
import { cryptoRng } from './poker/rng.js';
import { LlmTeacher, claudeCoachLlm } from './teacher/llmTeacher.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — fine; the coach reports itself unavailable without credentials.
}

// Preflop charts: solver output when PREFLOP_CHARTS names a file (preflop/charts/*.json), else the placeholders.
const charts = new ChartService(chartsFromEnv(process.env.PREFLOP_CHARTS, { lazyMixed: true }));
// Solved flops, one folder per spot (see solver/README.md). Spots without a folder run out after preflop.
// SOLVER_OUTPUT_DIR may list several folders, comma-separated (e.g. the 100bb flops and the 20/60bb ones).
const flopDirs = (process.env.SOLVER_OUTPUT_DIR ?? '').split(',').map((d) => d.trim()).filter(Boolean);
const flops = new FlopStore(flopDirs.length ? flopDirs : fileURLToPath(new URL('../../../solver/output', import.meta.url)));
// Live turn and river solving (docs/postflop-plan.md): off unless a solver service is configured.
const liveSolver = await liveSolverFromEnv();
// Opponent archetypes (docs/archetypes.md): preflop from the premade archetype charts for these charts
// (or rules where they have no answer), postflop from JEV AI with JEV_API_KEY (else the solver).
// They're built for the 100bb charts, so a manifest (stacks-v1) uses its 100bb charts' file (preflop-v9).
const jev = jevFromEnv();
const archetypeVersion = charts.profileVersion('100');
const archetypeCharts = process.env.ARCHETYPE_CHARTS || fileURLToPath(new URL(`../../../preflop/charts/archetypes/${archetypeVersion}.json`, import.meta.url));
const archetypes = new ArchetypeService(jev, {
  chartsFile: archetypeCharts,
  chartsVersion: archetypeVersion,
  // Logged during startup, before the app (and its logger) exists.
  log: (msg) => console.warn(msg),
});
const engine = new HandEngine(charts, cryptoRng, runoutResolver, flops, liveSolver !== null, archetypes);

// Player data lives in Supabase Postgres; without DATABASE_URL it's kept in memory (lost on restart).
const repo: Repo = process.env.DATABASE_URL ? new PgRepo(createDb(process.env.DATABASE_URL)) : new MemoryRepo();
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const model = process.env.CLAUDE_MODEL || 'claude-opus-5';
const app = buildApp({
  charts,
  engine,
  hands: new HandService(engine, repo, undefined, liveSolver, (msg) => app.log.warn(msg)),
  players: new PlayerResolver(supabaseUrl ? supabaseVerifier(supabaseUrl) : null, repo),
  teacher: new LlmTeacher(
    claudeCoachLlm(model),
    model,
    Number(process.env.EXPLANATION_MISS_LIMIT_PER_HOUR) || 50,
    Number(process.env.COACH_GLOBAL_LIMIT_PER_HOUR) || undefined,
  ),
  accounts: supabaseUrl && serviceKey ? supabaseAccountAdmin(supabaseUrl, serviceKey) : undefined,
});
if (!process.env.DATABASE_URL) app.log.warn('DATABASE_URL is not set: player data is kept in memory only.');
app.log.info(liveSolver ? 'live turn and river solving is on' : 'live turn and river solving is off: hands run out after the flop');
app.log.info(
  `opponent archetypes: preflop from ${archetypes.chartedNodes ? `${archetypes.chartedNodes} premade spots (rules elsewhere)` : 'built-in rules (no archetype charts built for these charts)'}; ` +
    `postflop ${jev ? 'by JEV AI' : 'from the solver (JEV_API_KEY is not set)'}`,
);
if (!supabaseUrl) app.log.warn('SUPABASE_URL is not set: sign-in is disabled; everyone plays as a guest.');

// Guest data lasts one session: sessions with no new hand for 24 hours are deleted.
const GUEST_IDLE_MS = 24 * 60 * 60 * 1000;
const purgeGuests = () =>
  repo
    .purgeIdleGuestSessions(new Date(Date.now() - GUEST_IDLE_MS))
    .then((n) => n && app.log.info(`deleted ${n} idle guest session(s)`))
    .catch((err) => app.log.error(err, 'guest cleanup failed'));
void purgeGuests();
setInterval(purgeGuests, 60 * 60 * 1000).unref();

const port = Number(process.env.PORT) || 3001;
// Containers need HOST=0.0.0.0; locally the API stays on loopback.
await app.listen({ port, host: process.env.HOST || '127.0.0.1' });
