import { buildApp } from './app.js';
import { ChartService } from './charts/chartService.js';
import { buildFixtureChartSet } from './charts/fixtures.js';
import { HandEngine, HandStore } from './engine/handEngine.js';
import { runoutResolver } from './engine/showdownResolver.js';
import { cryptoRng } from './poker/rng.js';
import { LlmTeacher, claudeGenerator } from './teacher/llmTeacher.js';

try {
  process.loadEnvFile('.env');
} catch {
  // No .env file — fine; the coach reports itself unavailable without credentials.
}

const charts = new ChartService(buildFixtureChartSet());
const model = process.env.CLAUDE_MODEL || 'claude-opus-5';
const app = buildApp({
  charts,
  engine: new HandEngine(charts, cryptoRng, runoutResolver),
  store: new HandStore(),
  teacher: new LlmTeacher(claudeGenerator(model), model, Number(process.env.EXPLANATION_MISS_LIMIT_PER_HOUR) || 50),
});

const port = Number(process.env.PORT) || 3001;
await app.listen({ port, host: '127.0.0.1' });
