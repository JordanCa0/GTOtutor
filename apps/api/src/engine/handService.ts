import type { ActionLogEntry, ActionType, DecisionFeedback, StartHandRequest } from '@gtotutor/shared-types';
import { samePlayer, type CoachMessage, type HandRecord, type Player, type Repo } from '../db/repo.js';
import { HttpError, type HandEngine, type HandState, type StoredHandState } from './handEngine.js';

/** What the coach needs about a hand, whether it's in progress or finished. */
export interface HandContext {
  id: string;
  owner: Player;
  heroPosition: string;
  stackDepthBb: number;
  board: string[];
  actionLog: ActionLogEntry[];
  decisions: DecisionFeedback[];
}

const notFound = () => new HttpError(404, 'Hand not found.');

/**
 * Hands for a player: the engine plays them, the repo stores them. Hands being played stay in
 * memory as well; every change is written through, so a restart (or another server) carries on
 * from the database. Every lookup checks the hand belongs to the requesting player.
 */
export class HandService {
  private readonly live = new Map<string, { owner: Player; state: HandState }>();

  constructor(
    private readonly engine: HandEngine,
    private readonly repo: Repo,
    private readonly maxLive = 2000,
  ) {}

  async start(player: Player, req: StartHandRequest): Promise<HandState> {
    if (!req.sessionId) throw new HttpError(400, 'A session id is required.');
    const owner = await this.repo.ensureSession(req.sessionId, player);
    if (!samePlayer(owner, player)) throw new HttpError(403, 'That session belongs to another player.');
    // Guest data lasts one session: starting a hand in a new session ends the previous ones.
    if (player.kind === 'guest') await this.repo.deleteGuestSessions(player.guestId, req.sessionId);
    const state = this.engine.start(req);
    this.remember(player, state);
    await this.save(player, state);
    return state;
  }

  /** A hand still in progress (or just finished and still in memory). */
  async get(player: Player, handId: string): Promise<HandState> {
    const hit = this.live.get(handId);
    if (hit) {
      if (!samePlayer(hit.owner, player)) throw notFound();
      return hit.state;
    }
    const rec = await this.repo.getHand(handId);
    if (!rec || !samePlayer(rec.owner, player)) throw notFound();
    if (!rec.state) throw new HttpError(409, 'This hand is finished.');
    const state = this.engine.restore(rec.state as StoredHandState);
    this.remember(player, state);
    return state;
  }

  async decide(player: Player, handId: string, action: ActionType): Promise<{ state: HandState; feedback: DecisionFeedback }> {
    const state = await this.get(player, handId);
    const feedback = this.engine.decide(state, action);
    await this.save(player, state);
    return { state, feedback };
  }

  async markHintUsed(player: Player, handId: string): Promise<void> {
    const state = await this.get(player, handId);
    this.engine.markHintUsed(state);
    await this.save(player, state);
  }

  /** Coach context for any of the player's hands, finished ones included. */
  async context(player: Player, handId: string): Promise<HandContext> {
    const hit = this.live.get(handId);
    if (hit) {
      if (!samePlayer(hit.owner, player)) throw notFound();
      return contextOf(handId, hit.owner, hit.state);
    }
    const rec = await this.repo.getHand(handId);
    if (!rec || !samePlayer(rec.owner, player)) throw notFound();
    if (rec.state) return contextOf(handId, rec.owner, rec.state as StoredHandState);
    return {
      id: handId,
      owner: rec.owner,
      heroPosition: rec.heroPosition,
      stackDepthBb: rec.config.stackDepthBb,
      board: rec.replay?.result.board ?? [],
      actionLog: rec.replay?.actionLog ?? [],
      decisions: rec.decisions,
    };
  }

  /** A decision's saved coach thread. Takes a context from `context()`, which has checked ownership. */
  async coachMessages(ctx: HandContext, decisionId: string): Promise<CoachMessage[]> {
    return this.repo.coachMessages(decisionOf(ctx, decisionId));
  }

  async addCoachMessages(ctx: HandContext, decisionId: string, messages: CoachMessage[]): Promise<void> {
    await this.repo.addCoachMessages(decisionOf(ctx, decisionId), ctx.owner, messages);
  }

  /** A session's hands; an unknown session is empty, someone else's is not found. */
  async sessionHands(player: Player, sessionId: string): Promise<HandRecord[]> {
    const owner = await this.repo.sessionOwner(sessionId);
    if (!owner) return [];
    if (!samePlayer(owner, player)) throw new HttpError(404, 'Session not found.');
    return this.repo.sessionHands(sessionId);
  }

  /** Moves a guest's data to a signed-in account (on sign-up or sign-in). */
  async claimGuest(guestId: string, userId: string): Promise<void> {
    await this.repo.claimGuest(guestId, userId);
    for (const entry of this.live.values()) {
      if (entry.owner.kind === 'guest' && entry.owner.guestId === guestId) entry.owner = { kind: 'user', userId };
    }
  }

  private remember(owner: Player, state: HandState): void {
    this.live.delete(state.id);
    this.live.set(state.id, { owner, state });
    if (this.live.size > this.maxLive) this.live.delete(this.live.keys().next().value!);
  }

  private async save(owner: Player, state: HandState): Promise<void> {
    const complete = state.result !== null;
    const hero = state.players.find((p) => p.isHero)!;
    await this.repo.saveHand({
      id: state.id,
      sessionId: state.sessionId!,
      owner,
      status: complete ? 'complete' : 'awaiting_hero',
      heroPosition: hero.position,
      config: { ...state.config, easyFoldsSkipped: state.easyFoldsSkipped },
      flopPractice: state.flopPractice,
      // Once a hand is over, the engine state (deck, every hole card) is dropped; the replay keeps what history needs.
      state: complete ? null : this.engine.serialize(state),
      replay: complete ? { actionLog: state.actionLog, result: state.result! } : null,
      netBb: state.result?.heroNetBb ?? null,
      decisions: state.decisions,
    });
  }
}

const decisionOf = (ctx: HandContext, decisionId: string): string => {
  if (!ctx.decisions.some((d) => d.id === decisionId)) throw new HttpError(404, 'Decision not found.');
  return decisionId;
};

const contextOf = (id: string, owner: Player, s: Pick<HandState, 'heroPosition' | 'config' | 'board' | 'actionLog' | 'decisions'>): HandContext => ({
  id,
  owner,
  heroPosition: s.heroPosition,
  stackDepthBb: s.config.stackDepthBb,
  board: s.board,
  actionLog: s.actionLog,
  decisions: s.decisions,
});
