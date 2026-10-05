/**
 * Manual UI check only (never shipped): runs the API with a scripted coach so the explanation,
 * hint, chat and session-review panels can be seen with content without an API key.
 *   npx tsx test/fakeCoachServer.ts   (listens on :3002)
 */
import { buildApp } from '../src/app.js';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { cryptoRng } from '../src/poker/rng.js';
import { LlmTeacher, type CoachLlm } from '../src/teacher/llmTeacher.js';
import { memoryDeps } from './fakes.js';

const scripted: CoachLlm = {
  async structured(_system, messages) {
    const ctx = messages[0].content;
    if (ctx.startsWith('Session stats')) {
      return {
        summary: 'Solid first session: you found the chart play in most spots, and your mistakes cluster in one area.',
        leaks: [{ title: 'Loose defends', advice: 'Against early-position opens, offsuit broadways like KJo and QTo mostly fold.' }],
        drill: 'Play 20 hands from the BB and focus on which hands continue against UTG versus BTN opens.',
      } as never;
    }
    const strategy = ctx.match(/Chart strategy for .*$/m)?.[0] ?? '';
    return {
      tldr: '(Scripted) Correct: position and a good price make this the standard play.',
      points: [`(Scripted) ${strategy}`, 'Your hand plays well against the opener\'s range.', 'The alternative risks more for less.'],
    } as never;
  },
  async text(_system, messages) {
    const last = messages.at(-1)!.content;
    if (last.includes('Give me a hint')) return '(Scripted hint.) Think about how many players are left to act behind you and how your hand plays when called.';
    return `(Scripted reply.) You asked: "${last}". A real coach answer grounded in the chart would appear here.`;
  },
};

const charts = new ChartService(buildFixtureChartSet());
const engine = new HandEngine(charts, cryptoRng, runoutResolver);
const app = buildApp({
  charts,
  engine,
  ...memoryDeps(engine),
  teacher: new LlmTeacher(scripted, 'scripted', 1000),
});
await app.listen({ port: 3002, host: '127.0.0.1' });
