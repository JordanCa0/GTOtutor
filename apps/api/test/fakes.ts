import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { vi } from 'vitest';
import { PlayerResolver } from '../src/auth/player.js';
import { InvalidToken, type AuthVerifier } from '../src/auth/verify.js';
import { MemoryRepo } from '../src/db/repo.js';
import type { HandEngine } from '../src/engine/handEngine.js';
import { HandService } from '../src/engine/handService.js';
import type { FlopFile } from '../src/postflop/flopStore.js';
import { ExplanationUnavailable, type CoachLlm } from '../src/teacher/llmTeacher.js';

/** Scripted CoachLlm for tests: pass canned structured/text answers (or functions producing them). */
export function fakeLlm(opts: { structured?: unknown | (() => unknown); text?: string | string[] | (() => string) } = {}) {
  const texts = Array.isArray(opts.text) ? [...opts.text] : null;
  const structured = vi.fn(async () => (typeof opts.structured === 'function' ? (opts.structured as () => unknown)() : opts.structured));
  const text = vi.fn(async () => {
    if (texts) return texts.shift() ?? '';
    return typeof opts.text === 'function' ? opts.text() : (opts.text ?? '');
  });
  return { structured, text } as unknown as CoachLlm & { structured: typeof structured; text: typeof text };
}

export function unavailableLlm(reason = 'no key'): CoachLlm {
  const fail = () => Promise.reject(new ExplanationUnavailable(reason));
  return { structured: fail, text: fail };
}

/** Test sign-in: a token "test-user:<uuid>" is that user; anything else is rejected. */
export const fakeVerifier: AuthVerifier = {
  async verify(token) {
    const m = /^test-user:([0-9a-f-]{36})$/.exec(token);
    if (!m) throw new InvalidToken('Invalid or expired sign-in.');
    return { userId: m[1], email: `${m[1].slice(0, 4)}@example.com`, name: null };
  },
};

/** App dependencies backed by the in-memory repo, plus that repo for assertions. */
export function memoryDeps(engine: HandEngine) {
  const repo = new MemoryRepo();
  return { repo, hands: new HandService(engine, repo), players: new PlayerResolver(fakeVerifier, repo) };
}

/** Injects as a guest by default (and gives new hands a session id), the way the browser calls the API. */
export function client(app: FastifyInstance, who: { guestId?: string; token?: string } = {}, sessionId = 'test-session-0001') {
  const headers: Record<string, string> = who.token ? { authorization: `Bearer ${who.token}` } : { 'x-guest-id': who.guestId ?? GUEST };
  return (opts: InjectOptions) => {
    const payload = opts.method === 'POST' && opts.url === '/api/hands' && opts.payload && typeof opts.payload === 'object' && !('sessionId' in opts.payload) ? { ...opts.payload, sessionId } : opts.payload;
    return app.inject({ ...opts, payload, headers: { ...headers, ...(opts.headers ?? {}) } } as InjectOptions);
  };
}

export const GUEST = '11111111-1111-4111-8111-111111111111';

/** A tiny solved spot: one rainbow flop where BB always checks and BTN checks or bets 1.8 half the time. */
/** A one-flop solve (BB always checks first). `threeBets`: BTN bets 33/66/100% after the check (game tree v9), with EVs. */
export function fakeSolverOutput({ threeBets = false } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'gtotutor-flops-'));
  const dir = join(root, 'btn_vs_bb_srp_100');
  mkdirSync(dir);
  const board = new Set(['Kh', '7d', '2c']);
  const cards = [...'23456789TJQKA'].flatMap((r) => [...'cdhs'].map((s) => r + s)).filter((c) => !board.has(c));
  const hands: string[] = [];
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) hands.push(cards[j] + cards[i]);
  const n = hands.length;
  const fill = (v: number) => new Array<number>(n).fill(v);
  const file: FlopFile = {
    spot: 'btn_vs_bb_srp_100',
    flop: 'Kh7d2c',
    hands: [hands, hands],
    nodes: [
      { history: [], player: 0, actions: ['check', 'bet 1.8'], strategy: [fill(1000), fill(0)] },
      ...(threeBets
        ? [
            // Check 40%, bet 33% 50%, 66% 5%, 100% 5%. Against the 33% bet the 66% bet loses 0.02bb, the 100% bet 0.5bb.
            { history: [0], player: 1 as const, actions: ['check', 'bet 1.8', 'bet 3.65', 'bet 5.5'], strategy: [fill(400), fill(500), fill(50), fill(50)], ev_bb: [fill(1), fill(1.2), fill(1.18), fill(0.7)] },
            ...[1, 2, 3].map((i) => ({ history: [0, i], player: 0 as const, actions: ['fold', 'call', 'raise 9'], strategy: [fill(0), fill(1000), fill(0)] })),
          ]
        : [
            { history: [0], player: 1 as const, actions: ['check', 'bet 1.8'], strategy: [fill(500), fill(500)] },
            { history: [0, 1], player: 0 as const, actions: ['fold', 'call', 'raise 7.2'], strategy: [fill(0), fill(1000), fill(0)] },
          ]),
      { history: [1], player: 1, actions: ['fold', 'call', 'raise 7.2'], strategy: [fill(0), fill(1000), fill(0)] },
    ],
  };
  writeFileSync(join(dir, 'Kh7d2c.json'), JSON.stringify(file));
  // What the solver saves next to its flops; live turn solves read the ranges, pot and stacks from it.
  const ranks = 'AKQJT98765432';
  const classes = [...ranks].flatMap((a, i) => [...ranks].slice(i).map((b, j) => (j === 0 ? a + b : [a + b + 's', a + b + 'o']))).flat();
  writeFileSync(join(dir, '_spot.json'), JSON.stringify({ name: 'btn_vs_bb_srp_100', chips_per_bb: 20, pot_bb: 5.5, stack_bb: 97.5, oop_range: classes.join(','), ip_range: classes.join(',') }));
  return root;
}
