import { fileURLToPath } from 'node:url';
import { buildApp } from './app.js';
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
import { cryptoRng } from './poker/rng.js';
import { LlmTeacher, claudeCoachLlm } from './teacher/llmTeacher.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — fine; the coach reports itself unavailable without credentials.
}

// Preflop charts: solver output when PREFLOP_CHARTS names a file (preflop/charts/*.json), else the placeholders.
const charts = new ChartService(chartsFromEnv());
// Solved flops, one folder per spot (see solver/README.md). Spots without a folder run out after preflop.
const flops = new FlopStore(process.env.SOLVER_OUTPUT_DIR || fileURLToPath(new URL('../../../solver/output', import.meta.url)));
const engine = new HandEngine(charts, cryptoRng, runoutResolver, flops);

// Player data lives in Supabase Postgres; without DATABASE_URL it's kept in memory (lost on restart).
const repo: Repo = process.env.DATABASE_URL ? new PgRepo(createDb(process.env.DATABASE_URL)) : new MemoryRepo();
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const model = process.env.CLAUDE_MODEL || 'claude-opus-5';
const app = buildApp({
  charts,
  engine,
  hands: new HandService(engine, repo),
  players: new PlayerResolver(supabaseUrl ? supabaseVerifier(supabaseUrl) : null, repo),
  teacher: new LlmTeacher(claudeCoachLlm(model), model, Number(process.env.EXPLANATION_MISS_LIMIT_PER_HOUR) || 50),
  accounts: supabaseUrl && serviceKey ? supabaseAccountAdmin(supabaseUrl, serviceKey) : undefined,
});
if (!process.env.DATABASE_URL) app.log.warn('DATABASE_URL is not set: player data is kept in memory only.');
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
await app.listen({ port, host: '127.0.0.1' });
