import { MIN_DECISIONS_FOR_REVIEW, type HandView, type SessionReviewResponse, type SubmitDecisionResponse } from '@gtotutor/shared-types';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { PlayerResolver } from '../src/auth/player.js';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { createDb, PgRepo } from '../src/db/pgRepo.js';
import { MemoryRepo, type HandRecord, type Repo } from '../src/db/repo.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { HandService } from '../src/engine/handService.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { FlopStore } from '../src/postflop/flopStore.js';
import { seededRng } from '../src/poker/rng.js';
import { LlmTeacher, type CoachLlm } from '../src/teacher/llmTeacher.js';
import { client, fakeLlm, fakeSolverOutput, fakeVerifier, GUEST } from './fakes.js';

process.env.LOG_LEVEL = 'silent';
const charts = new ChartService(buildFixtureChartSet());
const flops = new FlopStore(fakeSolverOutput());
const OTHER_GUEST = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

const coachLlm = () => fakeLlm({ structured: () => ({ tldr: 'Correct: fine.', points: ['A.', 'B.'], detail: 'Detail.' }), text: 'Hint.' });

/** An app over a given repo; calling it twice with the same repo simulates a server restart. */
function makeApp(repo: Repo, accounts?: { deleteUser: (id: string) => Promise<void> }, llm: CoachLlm = coachLlm()) {
  const engine = new HandEngine(charts, seededRng(21), runoutResolver, flops);
  return buildApp({
    charts,
    engine,
    hands: new HandService(engine, repo),
    players: new PlayerResolver(fakeVerifier, repo),
    teacher: new LlmTeacher(llm, 'test', 50),
    accounts,
  });
}

const flopPractice = { method: 'POST' as const, url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BTN', flopPractice: true } };

describe('player identity and ownership', () => {
  const app = makeApp(new MemoryRepo());
  afterAll(() => app.close());

  it('requires a player identity for hands', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/hands', payload: { tableSize: 'SIX_MAX', stackDepthBb: 100, heroPosition: 'BTN', sessionId: 'no-identity-01' } });
    expect(res.statusCode).toBe(401);
    expect((await client(app, { token: 'forged' })({ method: 'GET', url: '/api/me' })).statusCode).toBe(401);
  });

  it("hides one player's hands, coach, and sessions from another", async () => {
    const mine = client(app);
    const theirs = client(app, { guestId: OTHER_GUEST });
    const hand = (await mine(flopPractice)).json<HandView>();
    const { feedback } = (await mine({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: 'check' } })).json<SubmitDecisionResponse>();
    for (const url of [`/api/hands/${hand.id}`, `/api/hands/${hand.id}/hint`, `/api/hands/${hand.id}/decisions/${feedback.id}/explanation`, '/api/sessions/test-session-0001/review']) {
      expect((await theirs({ method: 'GET', url })).statusCode).toBe(404);
    }
    expect((await theirs({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: 'check' } })).statusCode).toBe(404);
    // Someone else's session id can't be used to start hands in it.
    expect((await theirs(flopPractice)).statusCode).toBe(403);
    expect((await mine({ method: 'GET', url: `/api/hands/${hand.id}/decisions/${feedback.id}/explanation` })).json()).toMatchObject({ status: 'ok' });
  });
});

describe('hands survive a restart', () => {
  it('continues a flop hand in progress and coaches a finished one from the database', async () => {
    const repo = new MemoryRepo();
    const before = makeApp(repo);
    const hand = (await client(before)(flopPractice)).json<HandView>();
    expect(hand.pendingSpot!.street).toBe('flop');
    await before.close();

    const after = makeApp(repo); // fresh memory: everything comes from the repo
    const call = client(after);
    const reloaded = (await call({ method: 'GET', url: `/api/hands/${hand.id}` })).json<HandView>();
    expect(reloaded.board).toEqual(hand.board);
    expect(reloaded.legalActions.map((a) => a.label)).toEqual(hand.legalActions.map((a) => a.label));
    const res = await call({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: 'bet' } });
    expect(res.statusCode).toBe(200);
    const { feedback, hand: done } = res.json<SubmitDecisionResponse>();
    expect(done.status).toBe('complete');
    await after.close();

    // Finished: the engine state is dropped, the replay and decisions remain.
    const stored = (await repo.getHand(hand.id))!;
    expect(stored.state).toBeNull();
    expect(stored.replay!.actionLog.length).toBeGreaterThan(6);
    expect(stored.decisions.map((d) => d.id)).toEqual([feedback.id]);

    const third = makeApp(repo);
    const coach = await client(third)({ method: 'GET', url: `/api/hands/${hand.id}/decisions/${feedback.id}/explanation` });
    expect(coach.json()).toMatchObject({ status: 'ok' });
    expect((await client(third)({ method: 'GET', url: `/api/hands/${hand.id}` })).statusCode).toBe(409);
    const review = (await client(third)({ method: 'GET', url: '/api/sessions/test-session-0001/review' })).json<SessionReviewResponse>();
    expect(review.stats.decisions).toBe(1);
    await third.close();
  });
});

describe('saved coach threads', () => {
  it('pays for an explanation once, brings back the chat after a restart, and keeps both private', async () => {
    const repo = new MemoryRepo();
    const llm = coachLlm();
    const before = makeApp(repo, undefined, llm);
    const mine = client(before);
    const hand = (await mine(flopPractice)).json<HandView>();
    const { feedback } = (await mine({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: 'check' } })).json<SubmitDecisionResponse>();
    const base = `/api/hands/${hand.id}/decisions/${feedback.id}`;
    expect((await mine({ method: 'GET', url: `${base}/coach` })).json()).toEqual({ explanation: null, messages: [] });
    expect((await mine({ method: 'GET', url: `${base}/explanation` })).json()).toMatchObject({ status: 'ok', cached: false });
    await mine({ method: 'POST', url: `${base}/chat`, payload: { messages: [{ role: 'user', content: 'Why?' }] } });
    expect(llm.structured).toHaveBeenCalledTimes(2);
    await before.close();

    const after = makeApp(repo, undefined, llm); // empty in-memory caches
    const again = client(after);
    expect((await again({ method: 'GET', url: `${base}/explanation` })).json()).toMatchObject({ status: 'ok', tldr: 'Correct: fine.', points: ['A.', 'B.'], cached: true });
    expect(llm.structured).toHaveBeenCalledTimes(2);
    expect((await again({ method: 'GET', url: `${base}/coach` })).json()).toEqual({
      explanation: { status: 'ok', tldr: 'Correct: fine.', points: ['A.', 'B.'], cached: true, ungroundedNumbers: [] },
      messages: [
        { role: 'user', content: 'Why?' },
        { role: 'assistant', tldr: 'Correct: fine.', content: 'Detail.' },
      ],
    });
    expect((await client(after, { guestId: OTHER_GUEST })({ method: 'GET', url: `${base}/coach` })).statusCode).toBe(404);
    expect((await again({ method: 'GET', url: `/api/hands/${hand.id}/decisions/not-a-decision/coach` })).statusCode).toBe(404);

    // Signing up carries the thread over.
    const user = client(after, { token: `test-user:${USER}` });
    await user({ method: 'POST', url: '/api/me/claim-guest', payload: { guestId: GUEST } });
    expect((await user({ method: 'GET', url: `${base}/coach` })).json().messages).toHaveLength(2);
    await after.close();
  });
});

describe('starred decisions', () => {
  it('stars a decision with a note, keeps it private and across a restart, and clears it on unstar', async () => {
    const repo = new MemoryRepo();
    const before = makeApp(repo);
    const mine = client(before);
    const hand = (await mine(flopPractice)).json<HandView>();
    const { feedback } = (await mine({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: 'check' } })).json<SubmitDecisionResponse>();
    const url = `/api/hands/${hand.id}/decisions/${feedback.id}/star`;
    expect((await mine({ method: 'GET', url })).json()).toEqual({ starred: false, note: null });
    const put = await mine({ method: 'PUT', url, payload: { starred: true, note: '  Check back vs this sizing  ' } });
    expect(put.json()).toEqual({ starred: true, note: 'Check back vs this sizing' });
    expect((await mine({ method: 'PUT', url, payload: { starred: true, note: 'x'.repeat(501) } })).statusCode).toBe(400);
    expect((await client(before, { guestId: OTHER_GUEST })({ method: 'PUT', url, payload: { starred: true } })).statusCode).toBe(404);
    expect((await mine({ method: 'PUT', url: `/api/hands/${hand.id}/decisions/not-a-decision/star`, payload: { starred: true } })).statusCode).toBe(404);
    await before.close();

    const after = makeApp(repo);
    const again = client(after);
    expect((await again({ method: 'GET', url })).json()).toEqual({ starred: true, note: 'Check back vs this sizing' });
    expect((await client(after, { guestId: OTHER_GUEST })({ method: 'GET', url })).statusCode).toBe(404);

    // Signing up carries the star over; unstarring clears the note.
    const user = client(after, { token: `test-user:${USER}` });
    await user({ method: 'POST', url: '/api/me/claim-guest', payload: { guestId: GUEST } });
    expect((await user({ method: 'GET', url })).json()).toEqual({ starred: true, note: 'Check back vs this sizing' });
    expect((await user({ method: 'PUT', url, payload: { starred: false, note: 'ignored' } })).json()).toEqual({ starred: false, note: null });
    expect((await user({ method: 'GET', url })).json()).toEqual({ starred: false, note: null });
    await after.close();
  });
});

describe('saved session reviews', () => {
  const reviewLlm = () => fakeLlm({ structured: () => ({ summary: 'Solid session.', leaks: [{ title: 'Flop checks', advice: 'Bet more.' }], drill: 'Play BTN vs BB flops.' }) });

  it('asks the coach once per decision count, then serves the saved review after a restart', async () => {
    const repo = new MemoryRepo();
    const llm = reviewLlm();
    const before = makeApp(repo, undefined, llm);
    const mine = client(before);
    let decisions = 0;
    while (decisions < MIN_DECISIONS_FOR_REVIEW) {
      let hand = (await mine(flopPractice)).json<HandView>();
      while (hand.status === 'awaiting_hero') {
        hand = (await mine({ method: 'POST', url: `/api/hands/${hand.id}/decisions`, payload: { action: hand.legalActions[0].id } })).json<SubmitDecisionResponse>().hand;
        decisions++;
      }
    }
    const url = '/api/sessions/test-session-0001/review';
    const first = (await mine({ method: 'GET', url })).json<SessionReviewResponse>();
    expect(first.coach).toMatchObject({ status: 'ok', summary: 'Solid session.' });
    expect(llm.structured).toHaveBeenCalledTimes(1);
    await before.close();

    const after = makeApp(repo, undefined, llm); // empty in-memory caches
    const again = (await client(after)({ method: 'GET', url })).json<SessionReviewResponse>();
    expect(again.coach).toEqual(first.coach);
    expect(again.stats.decisions).toBe(decisions);
    expect(llm.structured).toHaveBeenCalledTimes(1);
    expect((await client(after, { guestId: OTHER_GUEST })({ method: 'GET', url })).statusCode).toBe(404);
    await after.close();
  });
});

describe('guest data lasts one session', () => {
  it('deletes the previous session when a guest starts a new one, and idle sessions after 24 hours', async () => {
    const repo = new MemoryRepo();
    const app = makeApp(repo);
    const first = (await client(app, {}, 'guest-session-a')(flopPractice)).json<HandView>();
    await client(app, {}, 'guest-session-b')(flopPractice);
    expect(await repo.getHand(first.id)).toBeNull();
    expect(await repo.sessionOwner('guest-session-a')).toBeNull();

    repo.setLastActive('guest-session-b', new Date(Date.now() - 25 * 3600 * 1000));
    expect(await repo.purgeIdleGuestSessions(new Date(Date.now() - 24 * 3600 * 1000))).toBe(1);
    expect(await repo.sessionOwner('guest-session-b')).toBeNull();
    await app.close();
  });
});

describe('accounts', () => {
  it('moves guest data to the account on sign-in, then only the account can see it', async () => {
    const repo = new MemoryRepo();
    const app = makeApp(repo);
    const guest = client(app);
    const user = client(app, { token: `test-user:${USER}` });
    const hand = (await guest(flopPractice)).json<HandView>();

    expect((await user({ method: 'GET', url: '/api/me' })).json()).toMatchObject({ user: { id: USER } });
    expect((await client(app)({ method: 'GET', url: '/api/me' })).json()).toEqual({ user: null });
    expect((await guest({ method: 'POST', url: '/api/me/claim-guest', payload: { guestId: GUEST } })).statusCode).toBe(401);
    expect((await user({ method: 'POST', url: '/api/me/claim-guest', payload: { guestId: GUEST } })).statusCode).toBe(200);

    expect((await user({ method: 'GET', url: `/api/hands/${hand.id}` })).statusCode).toBe(200);
    expect((await guest({ method: 'GET', url: `/api/hands/${hand.id}` })).statusCode).toBe(404);
    expect((await repo.getHand(hand.id))!.owner).toEqual({ kind: 'user', userId: USER });
    expect(repo.profiles.has(USER)).toBe(true);
    // Signed-in data isn't subject to the guest one-session rule.
    await user({ ...flopPractice, payload: { ...flopPractice.payload, sessionId: 'user-session-2' } });
    expect(await repo.getHand(hand.id)).not.toBeNull();
    await app.close();
  });

  it('deletes an account through the admin hook, or says it is not configured', async () => {
    const deleteUser = vi.fn(async () => {});
    const app = makeApp(new MemoryRepo(), { deleteUser });
    expect((await client(app, { token: `test-user:${USER}` })({ method: 'DELETE', url: '/api/me' })).statusCode).toBe(200);
    expect(deleteUser).toHaveBeenCalledWith(USER);
    expect((await client(app)({ method: 'DELETE', url: '/api/me' })).statusCode).toBe(401);
    await app.close();
    const bare = makeApp(new MemoryRepo());
    expect((await client(bare, { token: `test-user:${USER}` })({ method: 'DELETE', url: '/api/me' })).statusCode).toBe(501);
    await bare.close();
  });
});

/** Storage behavior every Repo must have (guest rows only: user rows need real Supabase accounts). */
function repoContract(name: string, makeRepo: () => Repo, cleanup?: () => Promise<void>) {
  describe(`${name} repo contract`, () => {
    if (cleanup) afterAll(cleanup);
    const guestId = crypto.randomUUID();
    const sessionId = `contract-${guestId}`;
    const record = (id: string, status: HandRecord['status']): HandRecord => ({
      id,
      sessionId,
      owner: { kind: 'guest', guestId },
      status,
      heroPosition: 'BTN',
      config: { tableSize: 'SIX_MAX', stackDepthBb: 100, easyFoldsSkipped: true },
      flopPractice: false,
      state: status === 'complete' ? null : { any: 'state' },
      replay: status === 'complete' ? { actionLog: [], result: { board: [], showdown: null, winners: ['BTN'], potBb: 1.5, heroNetBb: 0.5, summary: 'x' } } : null,
      netBb: status === 'complete' ? 0.5 : null,
      decisions: [],
    });

    it('stores sessions, hands and decisions, and deletes a guest session with everything in it', async () => {
      const repo = makeRepo();
      expect(await repo.ensureSession(sessionId, { kind: 'guest', guestId })).toEqual({ kind: 'guest', guestId });
      // A second claim on the same session id keeps the first owner.
      expect(await repo.ensureSession(sessionId, { kind: 'guest', guestId: crypto.randomUUID() })).toEqual({ kind: 'guest', guestId });
      const id = crypto.randomUUID();
      await repo.saveHand(record(id, 'awaiting_hero'));
      const decision = { id: `${id}-d1`, nodeKey: 'SIX_MAX|100|RFI|BTN', nodeLabel: 'BTN first in', heroCards: ['As', 'Kd'], handClass: 'AKo', chosenAction: 'raise' as const, options: [], chosenFrequency: 1, bestAction: 'raise' as const, grade: 'best' as const, hintUsed: false, street: 'preflop' as const, board: [], approxFlop: null };
      await repo.saveHand({ ...record(id, 'complete'), decisions: [decision] });
      const chat = { kind: 'chat', tldr: null, points: null, ungrounded: null } as const;
      await repo.addCoachMessages(decision.id, { kind: 'guest', guestId }, [
        { ...chat, role: 'user', content: 'Why?' },
        { ...chat, role: 'assistant', content: 'Because.', tldr: 'Raise.' },
      ]);
      expect((await repo.coachMessages(decision.id)).map((m) => m.content)).toEqual(['Why?', 'Because.']);
      expect(await repo.star(decision.id)).toEqual({ starred: false, note: null });
      await repo.setStar(decision.id, { starred: true, note: 'Look again' });
      await repo.setStar(decision.id, { starred: true, note: 'Edited note' });
      expect(await repo.star(decision.id)).toEqual({ starred: true, note: 'Edited note' });
      const review = { status: 'ok' as const, summary: 'Fine.', leaks: [], drill: 'More flops.', ungroundedNumbers: [] };
      const stats = { hands: 1, decisions: 1, grades: { best: 1, mixed: 0, mistake: 0 }, hintsUsed: 0, bySpot: [], leaks: [], worstMistakes: [], easyFoldsSkipped: true };
      expect(await repo.sessionReview(sessionId, 1)).toBeNull();
      await repo.saveSessionReview(sessionId, 1, stats, review);
      await repo.saveSessionReview(sessionId, 1, stats, { ...review, summary: 'Replaced?' });
      expect(await repo.sessionReview(sessionId, 1)).toEqual(review);
      expect(await repo.sessionReview(sessionId, 2)).toBeNull();
      const got = (await repo.getHand(id))!;
      expect(got.status).toBe('complete');
      expect(got.state).toBeNull();
      expect(got.decisions).toEqual([decision]);
      expect((await repo.sessionHands(sessionId)).map((h) => h.id)).toEqual([id]);
      expect(await repo.getHand('not-a-uuid')).toBeNull();
      expect(await repo.deleteGuestSessions(guestId)).toBe(1);
      expect(await repo.getHand(id)).toBeNull();
      expect(await repo.sessionOwner(sessionId)).toBeNull();
      expect(await repo.coachMessages(decision.id)).toEqual([]);
      expect(await repo.star(decision.id)).toEqual({ starred: false, note: null });
      expect(await repo.sessionReview(sessionId, 1)).toBeNull();
    });
  });
}

repoContract('in-memory', () => new MemoryRepo());

// Against the real Supabase database only when asked: RUN_DB_TESTS=1 npm test -w apps/api
if (process.env.RUN_DB_TESTS === '1') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // DATABASE_URL may already be in the environment.
  }
  const db = createDb(process.env.DATABASE_URL!);
  repoContract('Postgres', () => new PgRepo(db), async () => {
    await db.$client.end();
  });
}
