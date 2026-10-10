import type { ActionLogEntry, ActionType, DecisionFeedback, DecisionStar, SessionStats, StartHandRequest } from '@gtotutor/shared-types';
import { playerKey, samePlayer, type CoachMessage, type HandRecord, type Player, type Repo, type SavedCoachReview } from '../db/repo.js';
import { LiveSolveError, type LiveSolver } from '../postflop/liveSolver.js';
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
  /** Hands waiting for their live turn solve: settles once the solve is attached (or the hand ran out) and saved. */
  private readonly solving = new Map<string, Promise<void>>();

  constructor(
    private readonly engine: HandEngine,
    private readonly repo: Repo,
    private readonly maxLive = 2000,
    /** Live turn and river solves; the engine must have live streets on too. */
    private readonly solver: LiveSolver | null = null,
    private readonly log: (msg: string) => void = () => {},
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
    this.startSolves(player, state);
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
    // On the turn or river after a restart: fetch the solve again (usually from the cache).
    this.startSolves(player, state);
    return state;
  }

  async decide(player: Player, handId: string, action: ActionType, toBb?: number): Promise<{ state: HandState; feedback: DecisionFeedback }> {
    const state = await this.get(player, handId);
    const feedback = this.engine.decide(state, action, toBb);
    await this.save(player, state);
    this.startSolves(player, state);
    return { state, feedback };
  }

  /** Resolves once the hand's pending live solve (if any) has been attached and saved. For tests and shutdown. */
  async settled(handId: string): Promise<void> {
    await this.solving.get(handId);
  }

  /**
   * Starts the live solves a hand needs: the turn it is waiting for, and, while hero decides on the
   * flop, the turns hero's options lead to (so the solve is usually ready when the turn comes).
   */
  private startSolves(owner: Player, state: HandState): void {
    const solver = this.solver;
    if (!solver) return;
    const who = playerKey(owner);
    if (this.engine.awaitingSolve(state) && !this.solving.has(state.id)) {
      const job = this.engine.pendingSolve(state);
      const done = (job ? solver.solve(job.request, job.label, who) : Promise.reject(new LiveSolveError('failed', 'no request')))
        .then(
          (solve) => this.engine.attachLiveSolve(state, solve),
          (err: unknown) => {
            this.log(`live solve for hand ${state.id} failed: ${(err as Error).message}`);
            this.engine.runOut(state, runOutNote(err));
          },
        )
        .then(() => this.save(owner, state))
        .catch((err: unknown) => this.log(`saving hand ${state.id} after its live solve failed: ${(err as Error).message}`))
        .finally(() => this.solving.delete(state.id));
      this.solving.set(state.id, done);
    }
    // At most three: one per option of hero's flop decision that reaches the turn.
    for (const job of this.engine.speculativeSolves(state).slice(0, 3)) {
      solver.solve(job.request, job.label, who).catch(() => undefined);
    }
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

  /** A decision's star and note. Takes a context from `context()`, which has checked ownership. */
  async star(ctx: HandContext, decisionId: string): Promise<DecisionStar> {
    return this.repo.star(decisionOf(ctx, decisionId));
  }

  async setStar(ctx: HandContext, decisionId: string, star: DecisionStar): Promise<void> {
    await this.repo.setStar(decisionOf(ctx, decisionId), star);
  }

  /** A session's hands; an unknown session is empty, someone else's is not found. */
  async sessionHands(player: Player, sessionId: string): Promise<HandRecord[]> {
    if (!(await this.ownsSession(player, sessionId))) return [];
    return this.repo.sessionHands(sessionId);
  }

  /** The coach review saved for one of the player's sessions at this many decisions. */
  async savedReview(player: Player, sessionId: string, decisionsCount: number): Promise<SavedCoachReview | null> {
    if (!(await this.ownsSession(player, sessionId))) return null;
    return this.repo.sessionReview(sessionId, decisionsCount);
  }

  async saveReview(player: Player, sessionId: string, stats: SessionStats, coach: SavedCoachReview): Promise<void> {
    if (!(await this.ownsSession(player, sessionId))) return;
    await this.repo.saveSessionReview(sessionId, stats.decisions, stats, coach);
  }

  // Profile page: signed-in accounts only (the routes check), always the requesting account's own data.

  playerDecisions(userId: string, limit: number) {
    return this.repo.playerDecisions(userId, limit);
  }

  starred(userId: string, before: Date | null, limit: number) {
    return this.repo.starredDecisions(userId, before, limit);
  }

  starredCount(userId: string) {
    return this.repo.starredCount(userId);
  }

  profileReview(userId: string) {
    return this.repo.profileReview(userId);
  }

  saveProfileReview(userId: string, decisionsCount: number, stats: SessionStats, coach: SavedCoachReview) {
    return this.repo.saveProfileReview(userId, decisionsCount, stats, coach);
  }

  /** False for an unknown session; throws (not found) for someone else's. */
  private async ownsSession(player: Player, sessionId: string): Promise<boolean> {
    const owner = await this.repo.sessionOwner(sessionId);
    if (!owner) return false;
    if (!samePlayer(owner, player)) throw new HttpError(404, 'Session not found.');
    return true;
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

/** What the player is told when the turn and river run out instead. */
function runOutNote(err: unknown): string {
  const reason = err instanceof LiveSolveError ? err.reason : 'failed';
  if (reason === 'limit') return 'Live turn solving is busy right now, so the turn and river were run out.';
  if (reason === 'timeout') return 'The turn took too long to solve, so the turn and river were run out.';
  return 'The turn could not be solved, so the turn and river were run out.';
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
