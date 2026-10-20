import { randomUUID } from 'node:crypto';
import {
  ARCHETYPES,
  SIX_MAX_POSITIONS,
  type ActionLogEntry,
  type Archetype,
  type ActionOption,
  type ActionType,
  type ChartNodeView,
  type DecisionFeedback,
  type Grade,
  type HandConfig,
  type HandResult,
  type HandStacks,
  type MixedStacks,
  type HandView,
  type LegalAction,
  type NoCallReason,
  type Position,
  type StackDepth,
  type StartHandRequest,
  type Street,
  type VillainRange,
} from '@gtotutor/shared-types';
import { ArchetypeService, type PostflopQuestion } from '../archetypes/archetypeService.js';
import { buildPostflopQuestion } from '../archetypes/postflopQuestion.js';
import type { ChartService } from '../charts/chartService.js';
import type { ChartNode } from '../charts/types.js';
import { FACING_TYPES, makeNodeKey, NOCALL_SUFFIX } from '../charts/nodeKeys.js';
import { mixedKind, parseProfile, profileBase, tierDepth } from '../charts/stackProfile.js';

/** What a raise is called at each raise level: the open is level 1, so re-raising it is a 3-bet. */
const RAISE_NAMES: Record<number, string> = { 1: '3-bet', 2: '4-bet', 3: '5-bet' };
import { ALL_HAND_CLASSES, comboCount, fullDeck, handClass, shuffle } from '../poker/cards.js';
import { bestHand, compareScores } from '../poker/evaluator.js';
import { handIndex, mapHand, parseCards } from '../postflop/flopMap.js';
import { flopClassStrategy, flopRangeSummary, historyKey, parseSolverAction, type FlopLookup, type FlopNode, type FlopStore, type LoadedFlop } from '../postflop/flopStore.js';
import { lineReach, mapBoardCard, preflopRanges, turnRequest, turnStart, type LiveOut, type LiveRequest } from '../postflop/liveSolve.js';
import type { SpotRanges } from '../teacher/spotSummary.js';
import type { Rng } from '../poker/rng.js';
import { FREE_PLAY_NOTE, freeActions, MULTIWAY_NOTE, ruleChoice, type FreePlayState } from './freePlay.js';
import type { ShowdownResolver } from './showdownResolver.js';

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

interface Player {
  position: Position;
  isHero: boolean;
  cards: string[];
  committed: number;
  folded: boolean;
  allIn: boolean;
  hasActed: boolean;
}

export interface HandState {
  id: string;
  sessionId: string | null;
  easyFoldsSkipped: boolean;
  /** The request's table settings, plus the stacks as dealt (hands saved before mixed stacks lack them). */
  config: HandConfig & Partial<HandStacks>;
  heroPosition: Position;
  players: Player[];
  deck: string[];
  currentBet: number;
  raiseLevel: number;
  opener: Position | null;
  lastRaiser: Position | null;
  /** The chart node the last raiser played from. Optional: hands saved before it existed lack it. */
  lastRaiseNode?: VillainRange | null;
  prevRaiser: Position | null;
  /** Set when the SB completes instead of raising (the only limp in the tree). */
  limper: Position | null;
  lastActorIndex: number;
  heroToAct: boolean;
  hintUsedPending: boolean;
  actionLog: ActionLogEntry[];
  decisions: DecisionFeedback[];
  showdownPositions: Position[];
  result: HandResult | null;
  /** Board cards dealt so far (the flop once postflop play starts). */
  board: string[];
  postflop: PostflopState | null;
  /**
   * A heads-up pot with no solved flops against an opponent JEV AI plays: played on a fixed tree,
   * hero ungraded (engine/freePlay.ts). Optional: hands saved before it existed lack it.
   */
  free?: FreePlayState | null;
  /**
   * Hero called where the charts keep pots heads-up (`overCall`), making the pot multiway: from then
   * on hero's decisions are played, not graded, and after the flop it's free play. Optional: hands
   * saved before it existed lack it.
   */
  multiway?: boolean;
  /** Dealt in flop practice mode (straight to a BTN vs BB flop). */
  flopPractice: boolean;
  /**
   * Simple pots: bots never limp or call ahead of hero, so hero can always call (see botAction).
   * Optional: hands saved before it existed lack it.
   */
  simplePots?: boolean;
  /**
   * The seat hero plays against: every other bot folds (see botAction). Optional: hands saved
   * before it existed lack it.
   */
  opponentPosition?: Position | null;
  /**
   * The player type each opponent plays as preflop (docs/archetypes.md); null or missing seats play
   * the charts. Optional: hands saved before archetypes lack it.
   */
  archetypes?: Partial<Record<Position, Archetype>> | null;
  /** Why the turn and river ran out instead of being played (the live solve failed, was too slow, or hit a limit). */
  liveNote?: string | null;
  /** The solver service commit behind this hand's turn and river strategies (AGPL source link). */
  solverCommit?: string | null;
}

/** A hand as stored in the database: the flop's solved data is looked up again on restore, the live solve fetched again. */
export type StoredHandState = Omit<HandState, 'postflop'> & {
  postflop:
    | (Pick<PostflopState, 'spot' | 'seats' | 'history' | 'base' | 'streetBets'> &
        Partial<Pick<PostflopState, 'street' | 'flopLine' | 'turnLine' | 'predraw' | 'forced'>>)
    | null;
};

/** A live turn solve: the turn decisions and, for the river card the deck holds, every river decision. */
interface LiveData {
  id: string;
  /** The solved board (the solved flop plus the mapped turn). */
  board: string[];
  hands: [string[], string[]];
  handIndexes: [Map<string, number>, Map<string, number>];
  turn: Map<string, FlopNode>;
  /** River decisions per turn line ("0.1"), for the dealt river card. */
  rivers: Map<string, Map<string, FlopNode>>;
  /** Each seat's hand in `hands`. */
  seatHands: [number, number];
  /** The river card dealt after each turn line. */
  riverCards: Map<string, string>;
  /** Both ranges at the start of the turn, over `hands` (for the coach); null if the spot info is missing. */
  startRanges: [number[], number[]] | null;
  /** OOP and IP positions. */
  positions: [Position, Position];
}

/**
 * A heads-up postflop hand: the flop played from solver output (`solver/output/<spot>`), then, with
 * live solving on, the turn and river from a live solve of the same spot.
 */
interface PostflopState {
  spot: string;
  lookup: FlopLookup;
  /** [OOP, IP]: solver player 0 and 1. */
  seats: [Position, Position];
  /** Each seat's hand, as an index into the solved flop file's hand list. */
  hands: [number, number];
  street: 'flop' | 'turn' | 'river';
  /** Action indexes taken so far on the current street. */
  history: number[];
  /** The flop's actions once the turn is dealt, and the turn's once the river is. */
  flopLine: number[] | null;
  turnLine: number[] | null;
  /**
   * Drawn when hero's flop decision comes up: the bot's reply to each of hero's options, so the
   * lines that will reach the turn are known (and solved) while hero thinks. Same frequencies as
   * drawing after hero acts. Never sent to the client.
   */
  predraw: Record<number, number> | null;
  /** The bot's next action, fixed by `predraw` once hero has chosen. */
  forced: number | null;
  /** JEV AI's frequencies for an archetype opponent's pending decision (see `applyVillainChoice`). Not stored. */
  villainChoice?: number[] | null;
  /** Who made that choice, for the action log (`ActionLogEntry.decidedBy`). Not stored. */
  villainSource?: { by: 'jev' | 'solver' | 'rules'; ms?: number } | null;
  /** The turn and river strategies once the live solve arrives (not stored). */
  live: LiveData | null;
  /** What each player had in when the current street started. */
  base: number;
  streetBets: Partial<Record<Position, number>>;
}

/** A turn solve to run: the request and what it is for. */
export interface LiveSolveJob {
  request: LiveRequest;
  /** Groups cache entries: the spot name. */
  label: string;
}

const FLOP_KEY = 'FLOP';
/** Free play's pending decisions (no strategy behind them). */
const FREE_KEY = 'FREE';
const LIVE_KEY = 'LIVE';
/** Node keys whose strategy comes from the flop solver (FLOP) or a live turn/river solve (LIVE). */
export const isFlopNodeKey = (nodeKey: string) => nodeKey.startsWith(`${FLOP_KEY}|`) || nodeKey.startsWith(`${LIVE_KEY}|`);

/** LIVE|<solve id>|<turn or river>|<turn line, river only>|<history on the street> */
function parseLiveNodeKey(nodeKey: string): { id: string; street: 'turn' | 'river'; turnLine: string; history: string } | null {
  const [kind, id, street, turnLine, history] = nodeKey.split('|');
  if (kind !== LIVE_KEY || !/^[0-9a-f]{32}$/.test(id ?? '') || (street !== 'turn' && street !== 'river')) return null;
  if (!/^(\d+(\.\d+)*)?$/.test(turnLine ?? 'x') || !/^(\d+(\.\d+)*)?$/.test(history ?? 'x')) return null;
  return { id, street, turnLine, history };
}

export function parseFlopNodeKey(nodeKey: string): { spot: string; flop: string; history: number[] } | null {
  const [kind, spot, flop, history] = nodeKey.split('|');
  if (kind !== FLOP_KEY || !spot || !flop || history === undefined) return null;
  if (!/^[a-z0-9_]+$/.test(spot) || !/^([2-9TJQKA][cdhs]){3}$/.test(flop) || !/^(\d+(\.\d+)*)?$/.test(history)) return null;
  return { spot, flop, history: history ? history.split('.').map(Number) : [] };
}

/** Postflop acting order: SB, BB, then UTG..BTN. */
const postflopIndex = (p: Position) => ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'].indexOf(p);

/** The chart profile a hand plays ("100", "100:BB20"); hands saved before mixed stacks are their depth. */
const profileOf = (state: HandState) => state.config.profile ?? String(state.config.stackDepthBb);
/** A seat's starting stack in bb. */
const stackOf = (state: HandState, pos: Position) => state.config.stacks?.[pos] ?? state.config.stackDepthBb;

const round2 = (x: number) => Math.round(x * 100) / 100;

/**
 * The main pot and side pots at showdown, smallest stake first. Each player still in can win, from
 * every player, at most what they put in themselves: one pot per distinct stake among the players
 * still in, open to those who put in at least that much. Folded players' chips count toward the
 * pots their amount reaches; anything above the biggest stake goes in the last pot.
 */
export function sidePots(players: Pick<Player, 'position' | 'committed'>[], live: Pick<Player, 'position' | 'committed'>[]): { amount: number; eligible: Position[] }[] {
  const levels = [...new Set(live.map((p) => p.committed))].sort((a, b) => a - b);
  const pots: { amount: number; eligible: Position[] }[] = [];
  let prev = 0;
  for (const level of levels) {
    const amount = players.reduce((s, p) => s + Math.max(0, Math.min(p.committed, level) - prev), 0);
    if (amount > 0) pots.push({ amount, eligible: live.filter((p) => p.committed >= level).map((p) => p.position) });
    prev = level;
  }
  const above = players.reduce((s, p) => s + Math.max(0, p.committed - prev), 0);
  if (above > 0 && pots.length) pots[pots.length - 1].amount += above;
  return pots.map((p) => ({ ...p, amount: round2(p.amount) }));
}
const MIXED_THRESHOLD = 0.1;
/** "Right idea, different size" when the chosen size gives up at most this share of the pot vs the best size of that action. */
const SIZE_EV_TOLERANCE = 0.01;
/**
 * Preflop, a rarely played option at most this many bb below the best EV is a close call (mixed).
 * The chart's model often sees two options as nearly equal (calling or 3-betting QQ in position at
 * 100bb is a few tenths of a bb apart) and settles on one, so picking the other is no mistake.
 */
const PREFLOP_CLOSE_EV_BB = 0.3;
const MAX_DEAL_ATTEMPTS = 200;

/** Hero's option: the only one of that type, or the one of that type at `toBb` (e.g. one of three flop bets). */
function chooseIndex(actions: LegalAction[], action: ActionType, toBb?: number): number {
  const matches = actions.flatMap((a, i) => (a.id === action ? [i] : []));
  if (!matches.length) throw new HttpError(400, `Illegal action "${action}" here.`);
  if (matches.length === 1) return matches[0];
  if (toBb === undefined) throw new HttpError(400, `There are several "${action}" sizes here; choose one with toBb.`);
  const i = matches.find((m) => actions[m].toBb !== null && Math.abs(actions[m].toBb! - toBb) < 1e-6);
  if (i === undefined) throw new HttpError(400, `There is no "${action}" of ${toBb}bb here.`);
  return i;
}

/**
 * best: the most frequent option. mixed: played at least MIXED_THRESHOLD of the time. Otherwise a
 * mistake, unless hero picked the right kind of action (e.g. bet) at a size the solver uses less:
 * that's "right idea, different size" (mixed) when that action is a real option and the size costs
 * little EV (or, without EVs, the solver uses it at least sometimes). With `closeEvBb`, any option
 * at most that many bb below the best EV is a close call (mixed, `closeEv`).
 */
export function gradeDecision(options: ActionOption[], chosen: number, potBb: number, closeEvBb = 0): { grade: Grade; sizeOnly: boolean; closeEv?: boolean } {
  const maxFreq = Math.max(...options.map((o) => o.frequency));
  const f = options[chosen].frequency;
  if (f >= maxFreq - 1e-9) return { grade: 'best', sizeOnly: false };
  if (f >= MIXED_THRESHOLD) return { grade: 'mixed', sizeOnly: false };
  const sizes = options.filter((o) => o.actionId === options[chosen].actionId);
  if (sizes.length > 1 && sizes.reduce((s, o) => s + o.frequency, 0) >= MIXED_THRESHOLD) {
    const ev = options[chosen].evBb;
    const bestEv = Math.max(...sizes.map((o) => o.evBb ?? -Infinity));
    const close = ev !== null && bestEv > -Infinity ? bestEv - ev <= SIZE_EV_TOLERANCE * potBb : f >= 0.01;
    if (close) return { grade: 'mixed', sizeOnly: true };
  }
  const ev = options[chosen].evBb;
  const bestEv = Math.max(...options.map((o) => o.evBb ?? -Infinity));
  if (closeEvBb > 0 && ev !== null && bestEv > -Infinity && bestEv - ev <= closeEvBb) return { grade: 'mixed', sizeOnly: false, closeEv: true };
  return { grade: 'mistake', sizeOnly: false };
}
const EASY_FOLD_THRESHOLD = 0.98;
/** Share of deals that skip the filter, so easy folds still show up occasionally for folding discipline. */
export const UNFILTERED_DEAL_RATE = 0.1;

export interface PendingDecision {
  nodeKey: string;
  nodeLabel: string;
  street: Street;
  /** Legal actions, aligned with `options`. */
  actions: LegalAction[];
  heroCards: string[];
  handClass: string;
  options: ActionOption[];
  approxFlop: string | null;
}

export class HandEngine {
  constructor(
    private readonly charts: ChartService,
    private readonly rng: Rng,
    private readonly resolver: ShowdownResolver,
    /** Solved flops; without it (or for unsolved spots) hands run out after preflop. */
    private readonly flops: FlopStore | null = null,
    /**
     * Play the turn and river from live solves (HandService runs them). Off: they run out after
     * the flop betting, as before.
     */
    private readonly liveStreets = false,
    /** How archetype opponents play preflop; without JEV AI they play from built-in rules. */
    readonly archetypes: ArchetypeService = new ArchetypeService(),
  ) {}

  /** Recent live solves by id, so the coach and the chart view can read their nodes. */
  private readonly recentLive = new Map<string, LiveData>();

  start(req: StartHandRequest): HandState {
    if (req.tableSize !== 'SIX_MAX') throw new HttpError(400, 'Only 6-max is available in this version.');
    const depths = this.depthsFor(req.mixedStacks);
    if (req.stackDepthBb === 'random' ? !depths.length : !depths.includes(req.stackDepthBb)) {
      const at = req.stackDepthBb === 'random' ? '' : ` at ${req.stackDepthBb}bb`;
      const what = req.mixedStacks ? `Mixed stacks (${req.mixedStacks === 'one' ? 'one short seat' : 'several short seats'})${at} are` : req.stackDepthBb === 'random' ? 'Random stack depths are' : `${req.stackDepthBb}bb is`;
      throw new HttpError(400, `${what} not available with these charts.`);
    }
    if (req.flopPractice && (req.stackDepthBb !== 100 || req.mixedStacks)) throw new HttpError(400, 'Flop practice is 100bb only.');
    if (req.heroPosition !== 'random' && !SIX_MAX_POSITIONS.includes(req.heroPosition)) {
      throw new HttpError(400, `Unknown position ${req.heroPosition}`);
    }
    if (req.flopPractice) return this.startFlopPractice(req);
    const opponent = req.opponentPosition && req.opponentPosition !== 'any' ? req.opponentPosition : null;
    if (opponent) {
      if (!SIX_MAX_POSITIONS.includes(opponent)) throw new HttpError(400, `Unknown position ${opponent}`);
      if (req.heroPosition === 'random') throw new HttpError(400, 'Choose your position to pick an opponent.');
      if (opponent === req.heroPosition) throw new HttpError(400, "Your opponent can't sit in your seat.");
    }
    const skipEasyFolds = (req.skipEasyFolds ?? true) && this.rng.float() >= UNFILTERED_DEAL_RATE;
    // Mixed stacks: one solved profile per hand, picked before the redeals so they reuse its chart.
    const profile = this.pickProfile(req);
    // Redeal hands with nothing to train on: walks in the BB, and (mostly) trivial folds.
    for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS; attempt++) {
      const state = this.deal(req, profile);
      this.advance(state);
      if (!state.heroToAct) continue;
      if (skipEasyFolds && this.isEasyFold(state)) continue;
      return state;
    }
    throw new HttpError(500, 'Could not deal a hand with a hero decision.');
  }

  /**
   * Testing aid: a BTN-vs-BB single-raised pot (folds to the BTN, BTN opens, SB folds, BB calls)
   * that starts at hero's flop decision. Hole cards are drawn so each player holds a hand the
   * charts actually play this way, in proportion to how often they do.
   */
  private startFlopPractice(req: StartHandRequest): HandState {
    if (!this.flops?.solvedFlops('btn_vs_bb_srp_100').length) throw new HttpError(400, 'Flop practice needs solved BTN vs BB flops in solver/output.');
    const heroPosition: Position = req.heroPosition === 'BTN' || req.heroPosition === 'BB' ? req.heroPosition : this.rng.int(2) ? 'BTN' : 'BB';
    const { tableSize, stackDepthBb } = req;
    const line: [Position, ActionType, string][] = [
      ['UTG', 'fold', makeNodeKey(tableSize, stackDepthBb, 'RFI', 'UTG')],
      ['HJ', 'fold', makeNodeKey(tableSize, stackDepthBb, 'RFI', 'HJ')],
      ['CO', 'fold', makeNodeKey(tableSize, stackDepthBb, 'RFI', 'CO')],
      ['BTN', 'raise', makeNodeKey(tableSize, stackDepthBb, 'RFI', 'BTN')],
      ['SB', 'fold', makeNodeKey(tableSize, stackDepthBb, 'VS_OPEN', 'SB', 'BTN')],
      ['BB', 'call', makeNodeKey(tableSize, stackDepthBb, 'VS_OPEN', 'BB', 'BTN')],
    ];
    const freq = (p: Player, nodeKey: string, action: ActionType) => {
      const node = this.charts.getNode(nodeKey);
      return node.strategy.get(handClass(p.cards[0], p.cards[1]))![node.actions.findIndex((a) => a.id === action)];
    };
    for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS * 20; attempt++) {
      const state = this.deal({ ...req, heroPosition }, '100');
      const byPos = (pos: Position) => state.players.find((p) => p.position === pos)!;
      // Keep the deal with the chance that BTN opens and BB calls with these exact hands.
      if (this.rng.float() >= freq(byPos('BTN'), line[3][2], 'raise') * freq(byPos('BB'), line[5][2], 'call')) continue;
      for (const [pos, action, nodeKey] of line) this.apply(state, byPos(pos), this.charts.getNode(nodeKey).actions.find((a) => a.id === action)!);
      this.advance(state);
      if (state.heroToAct) return state;
    }
    throw new HttpError(500, 'Could not deal a flop practice hand.');
  }

  /** The chart's answer for hero's pending decision, before hero chooses. */
  pendingDecision(state: HandState): PendingDecision | null {
    // A restored hand on the turn or river has no strategies until its solve is fetched again.
    if (!state.heroToAct || this.awaitingSolve(state)) return null;
    const hero = state.players.find((p) => p.isHero)!;
    const hc = handClass(hero.cards[0], hero.cards[1]);
    if (state.free) {
      const actions = this.freeActionsFor(state);
      return {
        nodeKey: `${FREE_KEY}|${state.free.street}`,
        nodeLabel: this.flopLabel(state, hero.position),
        street: state.free.street,
        actions,
        heroCards: [...hero.cards],
        handClass: hc,
        options: actions.map((a) => ({ actionId: a.id, label: a.label, toBb: a.toBb, frequency: 0, evBb: null })),
        approxFlop: null,
      };
    }
    if (state.postflop) {
      const pf = state.postflop;
      const node = this.streetNode(pf)!;
      const h = this.seatHand(pf, node.player);
      const actions = this.flopActions(pf, node);
      return {
        nodeKey:
          pf.street === 'flop'
            ? [FLOP_KEY, pf.spot, pf.lookup.data.flop, historyKey(pf.history)].join('|')
            : [LIVE_KEY, pf.live!.id, pf.street, pf.street === 'river' ? historyKey(pf.turnLine!) : '', historyKey(pf.history)].join('|'),
        nodeLabel: this.flopLabel(state, hero.position),
        street: pf.street,
        actions,
        heroCards: [...hero.cards],
        handClass: hc,
        options: actions.map((a, i) => ({
          actionId: a.id,
          label: a.label,
          toBb: a.toBb,
          frequency: node.strategy[i][h] / 1000,
          // The solver reports 0 for a hand that never gets here (hero left its line earlier): no EV then.
          evBb: node.ev_bb && (node.weights?.[h] ?? 1) > 0 ? node.ev_bb[i][h] : null,
        })),
        approxFlop: pf.lookup.approxFlop,
      };
    }
    const node = this.charts.getNode(this.nodeKeyFor(state, hero));
    const freqs = node.strategy.get(hc)!;
    const evs = node.ev.get(hc)!;
    const legal = this.legalActions(state, hero);
    return {
      nodeKey: node.nodeKey,
      nodeLabel: node.label,
      street: 'preflop',
      actions: node.actions,
      heroCards: [...hero.cards],
      handClass: hc,
      options: node.actions.map((a, i) => ({ actionId: a.id, label: legal[i].label, toBb: legal[i].toBb, frequency: freqs[i], evBb: evs[i] })),
      approxFlop: null,
    };
  }

  /** Share of the whole range taking each action at a node, for the coach. */
  rangeSummary(nodeKey: string): { label: string; share: number }[] {
    const live = this.liveNode(nodeKey);
    if (live) {
      const shares = flopRangeSummary({ hands: live.data.hands } as LoadedFlop, live.node);
      return live.node.actions.map((a, i) => ({ label: parseSolverAction(a).label, share: shares[i] }));
    }
    // A live solve that is no longer in memory: no whole-range numbers for the coach.
    if (nodeKey.startsWith(`${LIVE_KEY}|`)) return [];
    const flop = parseFlopNodeKey(nodeKey);
    if (!flop) {
      const node = this.charts.getNode(nodeKey);
      const shares = this.charts.rangeSummary(node);
      return node.actions.map((a, i) => ({ label: a.label, share: shares[i] }));
    }
    const { data, node } = this.solvedNode(flop);
    const shares = flopRangeSummary(data, node);
    return node.actions.map((a, i) => ({ label: parseSolverAction(a).label, share: shares[i] }));
  }

  /**
   * A flop, turn or river node as a 13x13 strategy view (averaged per hand class over the solved
   * board). `show` is hero's hand class, kept in the view even off the solver's line.
   */
  flopChartView(nodeKey: string, show?: string): ChartNodeView | null {
    const live = this.liveNode(nodeKey);
    if (live) {
      const { key } = live;
      return {
        nodeKey,
        label: `${key.street === 'turn' ? 'Turn' : 'River'} ${live.data.board.join('')}${key.history ? '' : ', first decision'} (live solver)`,
        actions: live.node.actions.map(parseSolverAction),
        strategy: flopClassStrategy({ hands: live.data.hands } as LoadedFlop, live.node, show),
        dataSource: { kind: 'solver', note: 'Turn and river strategy from a live solve.' },
      };
    }
    const flop = parseFlopNodeKey(nodeKey);
    if (!flop || !this.flops?.solvedFlops(flop.spot).includes(flop.flop)) return null;
    const { data, node } = this.solvedNode(flop);
    return {
      nodeKey,
      label: `Flop ${flop.flop}${flop.history.length ? '' : ', first decision'} (solver, ${flop.spot.replaceAll('_', ' ')})`,
      actions: node.actions.map(parseSolverAction),
      strategy: flopClassStrategy(data, node, show),
      dataSource: { kind: 'solver', note: 'Flop strategy from the offline solver.' },
    };
  }

  private solvedNode(flop: { spot: string; flop: string; history: number[] }): { data: LoadedFlop; node: FlopNode } {
    if (!this.flops) throw new HttpError(404, 'No solved flops are loaded.');
    const data = this.flops.load(flop.spot, flop.flop);
    const node = data.byHistory.get(historyKey(flop.history));
    if (!node) throw new HttpError(404, 'Flop node not found.');
    return { data, node };
  }

  /**
   * Plain-data copy of a hand for storage. The loaded solver data isn't stored: only the spot and
   * board are, and `restore` looks the solved flop up again.
   */
  serialize(state: HandState): StoredHandState {
    const { postflop, ...rest } = state;
    return structuredClone({
      ...rest,
      postflop: postflop && {
        spot: postflop.spot,
        seats: postflop.seats,
        history: postflop.history,
        base: postflop.base,
        streetBets: postflop.streetBets,
        street: postflop.street,
        flopLine: postflop.flopLine,
        turnLine: postflop.turnLine,
        predraw: postflop.predraw,
        forced: postflop.forced,
      },
    });
  }

  restore(stored: StoredHandState): HandState {
    const { postflop, ...rest } = structuredClone(stored);
    if (!postflop) return { ...rest, postflop: null };
    const lookup = this.flops?.lookup(postflop.spot, rest.board.slice(0, 3));
    if (!lookup) throw new HttpError(410, 'The solved flop data for this hand is no longer available.');
    const cards = (pos: Position) => rest.players.find((p) => p.position === pos)!.cards;
    // On the turn or river the live solve is fetched again (HandService; usually a cache hit).
    return {
      ...rest,
      postflop: {
        street: 'flop',
        flopLine: null,
        turnLine: null,
        predraw: null,
        forced: null,
        ...postflop,
        live: null,
        lookup,
        hands: [this.flops!.handFor(lookup, 0, cards(postflop.seats[0])), this.flops!.handFor(lookup, 1, cards(postflop.seats[1]))],
      },
    };
  }

  markHintUsed(state: HandState): void {
    if (state.heroToAct) state.hintUsedPending = true;
  }

  /**
   * Hero's ungraded decision (see `ungraded`): applied, not graded, as there is no chart or solver
   * answer. In free play, in a pot that went multiway, or the call that makes it multiway.
   */
  act(state: HandState, action: ActionType, toBb?: number): void {
    if (!state.heroToAct || state.result) throw new HttpError(409, 'It is not your turn — this hand is complete.');
    if (!this.ungraded(state, action)) throw new HttpError(409, 'This decision is graded; play it with decide().');
    if (state.free) {
      this.applyFree(state, chooseIndex(this.freeActionsFor(state), action, toBb));
    } else {
      const hero = state.players[this.nextToActIndex(state)!];
      const over = this.overCall(state);
      const actions = [...this.legalActions(state, hero), ...(over ? [over] : [])];
      const chosen = actions[chooseIndex(actions, action, toBb)];
      if (chosen === over) {
        state.multiway = true;
        state.liveNote = MULTIWAY_NOTE;
      }
      this.apply(state, hero, chosen);
    }
    this.advance(state);
  }

  /**
   * Hero's next action is played without a grade: in free play, once the pot has gone multiway, or
   * when it's the call that takes the pot multiway.
   */
  ungraded(state: HandState, action: ActionType): boolean {
    return this.playedUngraded(state) || (action === 'call' && this.overCall(state) !== null);
  }

  /** The hand is being played without grades: free play, or a pot that went multiway. */
  playedUngraded(state: HandState): boolean {
    return !state.result && (!!state.free || !!state.multiway);
  }

  /**
   * Hero's call where the charts keep pots heads-up (someone has already called): offered anyway,
   * and taking it makes the pot multiway (see `multiway`). Null when there's no such call.
   */
  private overCall(state: HandState): LegalAction | null {
    if (!state.heroToAct || state.postflop || state.free || state.result) return null;
    const hero = state.players[this.nextToActIndex(state)!];
    if (!hero?.isHero || !this.nodeKeyFor(state, hero).endsWith(NOCALL_SUFFIX)) return null;
    const stack = stackOf(state, hero.position);
    const callTo = Math.min(state.currentBet, stack);
    return { id: 'call', label: callTo >= stack ? `Call all-in ${callTo}` : `Call ${callTo}`, toBb: callTo };
  }

  decide(state: HandState, action: ActionType, toBb?: number): DecisionFeedback {
    if (state.free || state.multiway) throw new HttpError(409, 'This decision is not graded; play it with act().');
    const pending = this.pendingDecision(state);
    if (!pending) throw new HttpError(409, 'It is not your turn — this hand is complete.');
    const { options } = pending;
    const chosenIdx = chooseIndex(pending.actions, action, toBb);

    const maxFreq = Math.max(...options.map((o) => o.frequency));
    const bestIdx = options.findIndex((o) => o.frequency === maxFreq);
    const chosenFrequency = options[chosenIdx].frequency;
    const potBb = state.players.reduce((s, p) => s + p.committed, 0);
    const { grade, sizeOnly, closeEv } = gradeDecision(options, chosenIdx, potBb, pending.street === 'preflop' ? PREFLOP_CLOSE_EV_BB : 0);

    const feedback: DecisionFeedback = {
      id: `${state.id}-d${state.decisions.length + 1}`,
      nodeKey: pending.nodeKey,
      nodeLabel: pending.nodeLabel,
      heroCards: pending.heroCards,
      handClass: pending.handClass,
      chosenAction: action,
      options,
      chosenFrequency,
      bestAction: options[bestIdx].actionId,
      chosenIndex: chosenIdx,
      bestIndex: bestIdx,
      grade,
      ...(sizeOnly && { sizeOnly }),
      ...(closeEv && { closeEv }),
      hintUsed: state.hintUsedPending,
      street: pending.street,
      board: [...state.board],
      approxFlop: pending.approxFlop,
      ...(pending.street === 'preflop' && state.lastRaiseNode && state.lastRaiseNode.position !== state.heroPosition && { villainRange: { ...state.lastRaiseNode } }),
    };
    state.hintUsedPending = false;
    state.decisions.push(feedback);
    if (state.postflop) {
      const pf = state.postflop;
      this.applyFlop(state, this.streetNode(pf)!, chosenIdx);
      // The bot's reply was drawn when this decision came up (see `predraw`).
      pf.forced = pf.predraw?.[chosenIdx] ?? null;
      pf.predraw = null;
    } else {
      const hero = state.players[this.nextToActIndex(state)!];
      this.apply(state, hero, pending.actions[chosenIdx]);
    }
    this.advance(state);
    return feedback;
  }

  private isEasyFold(state: HandState): boolean {
    const pending = this.pendingDecision(state)!;
    return pending.options.some((o) => o.actionId === 'fold' && o.frequency >= EASY_FOLD_THRESHOLD);
  }

  view(state: HandState): HandView {
    const complete = state.result !== null;
    const pending = this.pendingDecision(state);
    const over = pending ? this.overCall(state) : null;
    return {
      id: state.id,
      config: state.config,
      heroPosition: state.heroPosition,
      heroCards: state.players.find((p) => p.isHero)!.cards,
      seats: state.players.map((p) => ({
        position: p.position,
        isHero: p.isHero,
        stackBb: round2(stackOf(state, p.position) - p.committed),
        committedBb: p.committed,
        folded: p.folded,
        allIn: p.allIn,
        cards: p.isHero || (complete && state.showdownPositions.includes(p.position)) ? p.cards : null,
        ...(!p.isHero && state.archetypes?.[p.position] && { archetype: state.archetypes[p.position] }),
      })),
      potBb: round2(state.players.reduce((s, p) => s + p.committed, 0)),
      board: state.board,
      actionLog: state.actionLog,
      legalActions: pending ? [...pending.options.map((o, i) => ({ ...pending.actions[i], label: o.label })), ...(over ? [over] : [])] : [],
      // Ungraded spots have no chart answer to show while hero decides.
      pendingSpot: pending && !state.free && !state.multiway ? {
        nodeKey: pending.nodeKey,
        nodeLabel: pending.nodeLabel,
        handClass: pending.handClass,
        street: pending.street,
        villainRange: pending.street === 'preflop' && state.lastRaiseNode?.position !== state.heroPosition ? (state.lastRaiseNode ?? null) : null,
      } : null,
      status: complete ? 'complete' : 'awaiting_hero',
      decisions: state.decisions,
      result: state.result,
      dataSource: this.charts.dataSource,
      solving: state.postflop && (this.awaitingSolve(state) || this.awaitingVillain(state)) ? (state.postflop.street as 'turn' | 'river') : null,
      freePlay: !!state.free,
      multiway: !!state.multiway,
      multiwayCall: !!over,
      liveNote: state.liveNote ?? null,
      solverCommit: state.solverCommit ?? null,
      noCallReason: pending ? this.noCallReason(state) : null,
    };
  }

  /** Solved mixed-stack profiles of one kind on a base depth ("100:BB20", or "100:UTG20:CO60:SB60"…). */
  private mixedProfiles(depth: number, kind: MixedStacks): string[] {
    return this.charts.profiles.filter((p) => mixedKind(p) === kind && profileBase(p) === depth && parseProfile(p));
  }

  /** The table depths the charts can deal, with equal stacks or with mixed stacks of one kind. */
  private depthsFor(kind: MixedStacks | undefined): number[] {
    const ids = kind ? this.charts.profiles.filter((p) => mixedKind(p) === kind && parseProfile(p)) : this.charts.profiles.filter((p) => mixedKind(p) === null);
    return [...new Set(ids.map(profileBase))];
  }

  /**
   * The chart profile for a hand: its depth (a random one for 'random'), or with mixed stacks a
   * random solved profile of that kind on that depth.
   */
  private pickProfile(req: StartHandRequest): string {
    const depths = this.depthsFor(req.mixedStacks);
    const depth = req.stackDepthBb === 'random' ? depths[this.rng.int(depths.length)] : req.stackDepthBb;
    const mixed = req.mixedStacks ? this.mixedProfiles(depth, req.mixedStacks) : [];
    return mixed.length ? mixed[this.rng.int(mixed.length)] : String(depth);
  }

  private deal(req: StartHandRequest, profile: string): HandState {
    const heroPosition = req.heroPosition === 'random' ? SIX_MAX_POSITIONS[this.rng.int(6)] : req.heroPosition;
    const deck = shuffle(fullDeck(), this.rng);
    const players: Player[] = SIX_MAX_POSITIONS.map((position) => ({
      position,
      isHero: position === heroPosition,
      cards: deck.splice(0, 2),
      committed: position === 'SB' ? 0.5 : position === 'BB' ? 1 : 0,
      folded: false,
      allIn: false,
      hasActed: false,
    }));
    return {
      id: randomUUID(),
      sessionId: req.sessionId ?? null,
      easyFoldsSkipped: req.skipEasyFolds ?? true,
      flopPractice: req.flopPractice ?? false,
      simplePots: req.simplePots ?? false,
      opponentPosition: req.opponentPosition && req.opponentPosition !== 'any' ? req.opponentPosition : null,
      archetypes: this.dealArchetypes(req, heroPosition),
      config: { tableSize: req.tableSize, stackDepthBb: profileBase(profile) as StackDepth, ...(req.mixedStacks && { mixedStacks: req.mixedStacks }), profile, stacks: parseProfile(profile)! },
      heroPosition,
      players,
      deck,
      currentBet: 1,
      raiseLevel: 0,
      opener: null,
      lastRaiser: null,
      prevRaiser: null,
      limper: null,
      lastActorIndex: players.length - 1,
      heroToAct: false,
      hintUsedPending: false,
      actionLog: [],
      decisions: [],
      showdownPositions: [],
      result: null,
      board: [],
      postflop: null,
    };
  }

  /**
   * Chart lookup key for `player`'s decision. Pots stay heads-up: once someone has called a bet,
   * players behind may only fold or raise (the preflop solver plays the same rule), so those
   * decisions use the chart's "|nocall" variant of the node.
   */
  private nodeKeyFor(state: HandState, player: Player): string {
    const key = this.baseNodeKeyFor(state, player);
    // A short stack all in for less than the bet has matched all it can.
    const matched = state.players.filter((p) => p !== player && !p.folded && p.committed >= Math.min(state.currentBet, stackOf(state, p.position))).length;
    // Facing a limp there's no call to block (fold or isolate), so those nodes have no "|nocall" variant.
    const hasCall = !this.charts.hasNode(key) || this.charts.getNode(key).actions.some((a) => a.id === 'call');
    return matched >= 2 && hasCall ? `${key}${NOCALL_SUFFIX}` : key;
  }

  /**
   * Behind an isolation raise, everyone but the limper folds, hero included: the pot stays limper vs
   * isolator, as in the preflop solver (preflop/src/game.rs).
   */
  private mustFold(state: HandState, player: Player): boolean {
    return state.raiseLevel === 1 && state.limper !== null && player.position !== state.limper;
  }

  /** Normalizes the live action history into a chart lookup key (2-player subgame abstraction). */
  private baseNodeKeyFor(state: HandState, player: Player): string {
    const { tableSize } = state.config;
    const profile = profileOf(state);
    const pos = player.position;
    // Facing an all-in below the 5-bet (only with a 20bb stack at the table): fold or call, under its
    // own key, as the same spot facing a normal raise offers a re-raise (game.rs `tier_node`).
    const raiser = state.lastRaiser && state.players.find((p) => p.position === state.lastRaiser);
    if (state.raiseLevel < 4 && raiser?.allIn) return makeNodeKey(tableSize, profile, 'VS_ALLIN', pos, raiser.position);
    if (state.raiseLevel === 0) {
      // Facing a limp: fold/check or isolate. Otherwise first in.
      return state.limper ? makeNodeKey(tableSize, profile, 'VS_LIMP', pos, state.limper) : makeNodeKey(tableSize, profile, 'RFI', pos);
    }
    if (state.raiseLevel === 1) {
      return pos === state.limper ? makeNodeKey(tableSize, profile, 'VS_ISO', pos, state.opener!) : makeNodeKey(tableSize, profile, 'VS_OPEN', pos, state.opener!);
    }
    const types = FACING_TYPES[state.raiseLevel];
    return pos === state.prevRaiser ? makeNodeKey(tableSize, profile, types.direct, pos, state.lastRaiser!) : makeNodeKey(tableSize, profile, types.cold, pos);
  }

  private legalActions(state: HandState, player: Player): LegalAction[] {
    const node = this.charts.getNode(this.nodeKeyFor(state, player));
    const stack = stackOf(state, player.position);
    const callTo = Math.min(state.currentBet, stack);
    const callLabel = state.raiseLevel === 0 ? 'Limp' : callTo >= stack ? `Call all-in ${callTo}` : `Call ${callTo}`;
    return node.actions.map((a) => (a.id === 'call' ? { ...a, label: callLabel, toBb: callTo } : a));
  }

  private apply(state: HandState, player: Player, action: LegalAction): void {
    const stack = stackOf(state, player.position);
    let toBb = player.committed;
    if (action.id === 'fold') {
      player.folded = true;
    } else if (action.id === 'check') {
      // Nothing to add: only offered when hero has already matched the bet.
    } else if (action.id === 'call') {
      if (state.raiseLevel === 0) state.limper = player.position;
      toBb = Math.min(state.currentBet, stack);
      player.committed = toBb;
    } else {
      state.lastRaiseNode = { position: player.position, nodeKey: this.nodeKeyFor(state, player), actionId: action.id };
      toBb = action.id === 'allin' ? stack : Math.min(action.toBb!, stack);
      player.committed = toBb;
      state.currentBet = Math.max(state.currentBet, toBb);
      if (state.raiseLevel === 0) state.opener = player.position;
      state.prevRaiser = state.lastRaiser;
      state.lastRaiser = player.position;
      state.raiseLevel++;
    }
    if (player.committed >= stack) player.allIn = true;
    player.hasActed = true;
    state.lastActorIndex = state.players.indexOf(player);
    state.actionLog.push({ position: player.position, action: action.id, toBb, isHero: player.isHero, street: 'preflop' });
  }

  private nextToActIndex(state: HandState): number | null {
    const n = state.players.length;
    for (let step = 1; step <= n; step++) {
      const i = (state.lastActorIndex + step) % n;
      const p = state.players[i];
      if (!p.folded && !p.allIn && (!p.hasActed || p.committed < state.currentBet)) return i;
    }
    return null;
  }

  private advance(state: HandState): void {
    state.heroToAct = false;
    for (;;) {
      if (state.players.filter((p) => !p.folded).length === 1) return this.finish(state);
      if (state.free) return this.advanceFree(state);
      if (state.postflop) return this.advanceFlop(state);
      const idx = this.nextToActIndex(state);
      if (idx === null) {
        if (this.startFlop(state)) continue;
        return this.finish(state);
      }
      const player = state.players[idx];
      if (this.mustFold(state, player)) {
        this.apply(state, player, { id: 'fold', label: 'Fold', toBb: null });
        continue;
      }
      if (player.isHero) {
        state.heroToAct = true;
        return;
      }
      const node = this.charts.getNode(this.nodeKeyFor(state, player));
      const playOn = player.position === state.opponentPosition && !player.hasActed;
      if (playOn) this.drawPlayingHand(state, player, node);
      const chart = this.villainFrequencies(state, player, node, handClass(player.cards[0], player.cards[1]));
      // The drawn hand plays on in its chart proportions without the fold (a mixed hand folds sometimes).
      const playable = chart.map((f, i) => (node.actions[i].id === 'fold' ? 0 : f));
      const freqs = playOn && playable.some((f) => f > 0) ? playable : chart;
      this.apply(state, player, this.botAction(state, player, node.actions[this.sample(freqs)]));
    }
  }

  /** Each opponent's archetype for a new hand, or null when they all play the charts. */
  private dealArchetypes(req: StartHandRequest, heroPosition: Position): Partial<Record<Position, Archetype>> | null {
    const style = req.villainStyle ?? 'gto';
    if (style === 'gto' || req.flopPractice) return null;
    const out: Partial<Record<Position, Archetype>> = {};
    for (const pos of SIX_MAX_POSITIONS) if (pos !== heroPosition) out[pos] = style === 'mixed' ? ARCHETYPES[this.rng.int(ARCHETYPES.length)] : style;
    return out;
  }

  /** A bot's frequencies for a hand at a chart node: its archetype's, or the chart's. */
  private villainFrequencies(state: HandState, player: Player, node: ChartNode, hc: string): number[] {
    const archetype = state.archetypes?.[player.position];
    if (!archetype) return node.strategy.get(hc)!;
    const baseKey = node.nodeKey.endsWith(NOCALL_SUFFIX) ? node.nodeKey.slice(0, -NOCALL_SUFFIX.length) : null;
    const base = baseKey && this.charts.hasNode(baseKey) ? this.charts.getNode(baseKey) : undefined;
    return this.archetypes.frequencies(archetype, node, hc, base);
  }

  /**
   * A chosen opponent's first decision: swap its hole cards for a hand from the undealt cards that
   * plays on here (opens, defends, 3-bets…), weighted by how often the chart plays it, so practising
   * against a seat never ends with it folding. Its later decisions follow the chart as dealt.
   */
  private drawPlayingHand(state: HandState, player: Player, node: ChartNode): void {
    const fold = node.actions.findIndex((a) => a.id === 'fold');
    if (fold < 0) return;
    const playOn = (cards: string[]) => 1 - this.villainFrequencies(state, player, node, handClass(cards[0], cards[1]))[fold];
    if (playOn(player.cards) > 0 && this.rng.float() < playOn(player.cards)) return;
    for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS * 20; attempt++) {
      const i = this.rng.int(state.deck.length);
      let j = this.rng.int(state.deck.length - 1);
      if (j >= i) j++;
      const cards = [state.deck[i], state.deck[j]];
      if (this.rng.float() >= playOn(cards)) continue;
      state.deck[i] = player.cards[0];
      state.deck[j] = player.cards[1];
      player.cards = cards;
      return;
    }
  }

  /**
   * A bot's chart action, except in simple pots: there a bot folds instead of limping or calling
   * while hero is still in, so hero never faces a caller (which would leave hero only fold or
   * raise, as pots stay heads-up). Two calls are kept, as they leave hero's options whole: calling
   * hero's own raise, and the SB completing into hero's big blind. Raising hands stay as charted.
   * With a chosen opponent, every other bot folds (a free check stays a check).
   */
  private botAction(state: HandState, player: Player, action: LegalAction): LegalAction {
    if (state.opponentPosition && player.position !== state.opponentPosition && action.id !== 'check') return { id: 'fold', label: 'Fold', toBb: null };
    if (!state.simplePots || action.id !== 'call') return action;
    const hero = state.players.find((p) => p.isHero)!;
    if (hero.folded) return action;
    const keep = state.raiseLevel === 0 ? hero.position === 'BB' && player.position === 'SB' : state.lastRaiser === hero.position;
    return keep ? action : { id: 'fold', label: 'Fold', toBb: null };
  }

  /**
   * Why hero has no Call here, for the greyed Call button's tooltip, or null: someone has already
   * called (pots stay heads-up, so it's re-raise or fold), or hero faces a limp (no limping behind).
   * Only comes up with simple pots off.
   */
  private noCallReason(state: HandState): NoCallReason | null {
    if (state.postflop || state.free || !state.heroToAct) return null;
    const hero = state.players.find((p) => p.isHero)!;
    const key = this.nodeKeyFor(state, hero);
    const node = this.charts.getNode(key);
    if (key.endsWith(NOCALL_SUFFIX)) {
      const raise = node.actions.some((a) => a.id === 'raise') ? (RAISE_NAMES[state.raiseLevel] ?? 'Raise') : node.actions.some((a) => a.id === 'allin') ? 'All-in' : null;
      if (!raise) return { title: 'Fold only', text: 'Someone already called, and pots stay heads-up after the flop.' };
      return { title: `${raise} or fold`, text: `Someone already called, so you play a ${raise.toLowerCase()}-or-fold strategy: pots stay heads-up after the flop, so calling isn't an option.` };
    }
    if (state.raiseLevel === 0 && state.limper && hero.position !== 'BB') {
      return { title: 'Raise or fold', text: "Someone limped, so you play a raise-or-fold strategy: pots stay heads-up after the flop, so limping behind isn't an option." };
    }
    return null;
  }

  private sample(freqs: number[]): number {
    const total = freqs.reduce((a, b) => a + b, 0);
    let roll = this.rng.float() * total;
    for (let i = 0; i < freqs.length; i++) {
      roll -= freqs[i];
      if (roll < 0) return i;
    }
    return freqs.length - 1;
  }

  /** The solver spot a heads-up pot belongs to, named like the files in solver/spots. */
  private spotName(state: HandState): string | null {
    const live = state.players.filter((p) => !p.folded).map((p) => p.position);
    if (live.length !== 2) return null;
    // Flops are solved per equal-stack depth: a heads-up pot plays the effective (smaller) stack's.
    const suffix = tierDepth(this.effectiveStack(state));
    if (state.limper) {
      // Limped lines are always limper vs BB (check behind) or limper vs isolator.
      const kind = ['limp', 'iso', 'l3b'][state.raiseLevel];
      const other = live.find((p) => p !== state.limper);
      if (!kind || !other || !live.includes(state.limper)) return null;
      return `${state.limper.toLowerCase()}_vs_${other.toLowerCase()}_${kind}_${suffix}`;
    }
    const opener = state.opener;
    if (!opener || !live.includes(opener)) return null;
    const other = live.find((p) => p !== opener)!;
    const name = (kind: string) => `${opener.toLowerCase()}_vs_${other.toLowerCase()}_${kind}_${suffix}`;
    if (state.raiseLevel === 1) return name('srp');
    if (state.raiseLevel === 2 && state.lastRaiser === other) return name('3bp');
    if (state.raiseLevel === 3 && state.lastRaiser === opener && state.prevRaiser === other) return name('4bp');
    return null;
  }

  /** The smallest starting stack among the players still in: all anyone can win or lose. */
  private effectiveStack(state: HandState): number {
    return Math.min(...state.players.filter((p) => !p.folded).map((p) => stackOf(state, p.position)));
  }

  /** Deals the flop and starts solver-driven flop play when this spot has solved flops. */
  private startFlop(state: HandState): boolean {
    if (state.postflop || state.free || state.board.length) return false;
    const live = state.players.filter((p) => !p.folded);
    if (live.some((p) => p.allIn)) return false;
    // A pot hero took multiway has no solver answers, even if it's back to heads-up by now.
    if (state.multiway) return this.startFreePlay(state);
    const spot = this.spotName(state);
    if (!this.flops || !spot || this.flops.solvedFlops(spot).length === 0) return this.startFreePlay(state);
    state.board = state.deck.splice(0, 3);
    const lookup = this.flops.lookup(spot, state.board);
    // A flop shape with no solved example: free play against JEV AI, or the hand runs out as before.
    if (!lookup) return this.startFreePlay(state);
    const seats = [...live].sort((a, b) => postflopIndex(a.position) - postflopIndex(b.position));
    const hands: [number, number] = [this.flops.handFor(lookup, 0, seats[0].cards), this.flops.handFor(lookup, 1, seats[1].cards)];
    // A hand with no place in the solved ranges (an empty range): free play, or run out rather than play blind.
    if (hands.some((h) => h < 0)) return this.startFreePlay(state);
    state.postflop = {
      spot,
      lookup,
      seats: [seats[0].position, seats[1].position],
      hands,
      street: 'flop',
      history: [],
      flopLine: null,
      turnLine: null,
      predraw: null,
      forced: null,
      live: null,
      base: live[0].committed,
      streetBets: {},
    };
    return true;
  }

  /**
   * Free play (engine/freePlay.ts) when the solver can't play this pot, with hero still in and nobody
   * all in: a heads-up pot against an opponent JEV AI plays, or any pot hero took multiway (chart
   * bots are played by JEV AI as a solid regular, or by simple rules without a key). Otherwise the
   * hand runs out, as before.
   */
  private startFreePlay(state: HandState): boolean {
    const live = state.players.filter((p) => !p.folded);
    if (live.length < 2 || !live.some((p) => p.isHero) || live.some((p) => p.allIn)) return false;
    if (!state.multiway && (live.length !== 2 || !this.jevPlays(state, live.find((p) => !p.isHero)!))) return false;
    if (!state.board.length) state.board = state.deck.splice(0, 3);
    const seats = [...live].sort((a, b) => postflopIndex(a.position) - postflopIndex(b.position)).map((p) => p.position);
    state.free = { seats, street: 'flop', base: live[0].committed, streetBets: {}, acted: [], aggression: 0 };
    state.liveNote = state.multiway ? MULTIWAY_NOTE : FREE_PLAY_NOTE;
    return true;
  }

  /** The biggest bet on this street among the players still in, other than `except`'s. */
  private freeTopBet(state: HandState, except?: Position): number {
    const f = state.free!;
    const bets = f.seats.filter((pos) => pos !== except && !state.players.find((p) => p.position === pos)!.folded).map((pos) => f.streetBets[pos] ?? 0);
    return Math.max(0, ...bets);
  }

  /**
   * Who acts next in free play, in seat order after the last to act: the first player still in with
   * chips behind who hasn't acted on this street or is short of the biggest bet. Null when the
   * street's betting is over.
   */
  private freeToAct(state: HandState): Position | null {
    const f = state.free!;
    const top = this.freeTopBet(state);
    const last = f.acted.at(-1);
    const from = last ? f.seats.indexOf(last) + 1 : 0;
    for (let k = 0; k < f.seats.length; k++) {
      const pos = f.seats[(from + k) % f.seats.length];
      const p = state.players.find((x) => x.position === pos)!;
      if (p.folded || p.allIn) continue;
      if (!f.acted.includes(pos) || (f.streetBets[pos] ?? 0) < top) return pos;
    }
    return null;
  }

  private freeActionsFor(state: HandState): LegalAction[] {
    const f = state.free!;
    const pos = this.freeToAct(state)!;
    const myBet = f.streetBets[pos] ?? 0;
    const potBb = round2(state.players.reduce((s, p) => s + p.committed, 0));
    return freeActions(f.street, potBb, myBet, this.freeTopBet(state, pos), round2(this.effectiveStack(state) - f.base - myBet), f.aggression);
  }

  /** A free-play opponent JEV AI decides for: an archetype, or in a multiway pot any bot (as a solid regular). */
  private freeJev(state: HandState, player: Player): boolean {
    return !player.isHero && this.archetypes.jevEnabled && (!!state.archetypes?.[player.position] || !!state.multiway);
  }

  /** Plays free-play streets until hero must act, JEV AI is awaited, or the hand ends. */
  private advanceFree(state: HandState): void {
    for (;;) {
      const f = state.free!;
      // Hero folded: whoever is left just runs it out.
      if (state.players.some((p) => p.isHero && p.folded)) return this.finish(state);
      const pos = this.freeToAct(state);
      if (pos === null) {
        // The street's betting is over: showdown after the river or an all-in, else the next card.
        if (f.street === 'river' || state.players.some((p) => !p.folded && p.allIn)) return this.finish(state);
        state.board.push(state.deck.shift()!);
        f.street = f.street === 'flop' ? 'turn' : 'river';
        f.base = state.players.find((p) => !p.folded)!.committed;
        f.streetBets = {};
        f.acted = [];
        f.aggression = 0;
        continue;
      }
      const player = state.players.find((p) => p.position === pos)!;
      if (player.isHero) {
        state.heroToAct = true;
        return;
      }
      let idx: number;
      let source: FreePlayState['villainSource'];
      if (this.freeJev(state, player)) {
        // HandService asks JEV AI (`villainQuestion`) and hands the answer back (`applyVillainChoice`).
        if (!f.villainChoice) return;
        idx = this.sample(f.villainChoice);
        source = f.villainSource ?? null;
        f.villainChoice = null;
        f.villainSource = null;
      } else {
        // A multiway pot with no JEV AI key: the bots play simple rules.
        idx = this.sample(ruleChoice(this.freeActionsFor(state), player.cards, state.board));
        source = { by: 'rules' };
      }
      this.applyFree(state, idx, source);
      if (state.players.filter((p) => !p.folded).length === 1) return this.finish(state);
    }
  }

  private applyFree(state: HandState, idx: number, source: FreePlayState['villainSource'] = null): void {
    const f = state.free!;
    const pos = this.freeToAct(state)!;
    const top = this.freeTopBet(state, pos);
    const action = this.freeActionsFor(state)[idx];
    const player = state.players.find((p) => p.position === pos)!;
    const effective = this.effectiveStack(state);
    let street = f.streetBets[pos] ?? 0;
    if (action.id === 'fold') player.folded = true;
    else if (action.id === 'call') street = Math.min(top, effective - f.base);
    else if (action.id !== 'check') {
      street = Math.min(action.toBb!, effective - f.base);
      if (street > top) f.aggression++;
    }
    f.streetBets[pos] = round2(street);
    player.committed = round2(f.base + street);
    if (player.committed >= effective) player.allIn = true;
    f.acted.push(pos);
    state.actionLog.push({
      position: pos,
      action: action.id,
      toBb: player.committed,
      isHero: player.isHero,
      street: f.street,
      streetBb: round2(street),
      ...(source && { decidedBy: source.by }),
      ...(source?.ms !== undefined && { jevMs: source.ms }),
    });
  }

  private streetNode(pf: PostflopState): FlopNode | undefined {
    const key = historyKey(pf.history);
    if (pf.street === 'flop') return pf.lookup.data.byHistory.get(key);
    if (pf.street === 'turn') return pf.live?.turn.get(key);
    return pf.live?.rivers.get(historyKey(pf.turnLine!))?.get(key);
  }

  /** A seat's hand index in the current street's data. */
  private seatHand(pf: PostflopState, player: 0 | 1): number {
    return pf.street === 'flop' ? pf.hands[player] : pf.live!.seatHands[player];
  }

  /** The node's actions with amounts for the table (a call shows what it calls). */
  private flopActions(pf: PostflopState, node: FlopNode): LegalAction[] {
    const facing = pf.streetBets[pf.seats[1 - node.player]] ?? 0;
    return node.actions.map(parseSolverAction).map((a) => (a.id === 'call' ? { ...a, label: `Call ${facing}`, toBb: facing } : a));
  }

  private flopLabel(state: HandState, pos: Position): string {
    const street = state.postflop?.street ?? state.free?.street ?? 'flop';
    const last = state.actionLog.filter((a) => a.street === street).at(-1);
    if (!last) return `${pos} first to act on the ${street}`;
    if (last.action === 'check') return `${pos} on the ${street} after ${last.position} checks`;
    if (last.action === 'bet') return `${pos} facing a ${last.streetBb}bb ${street} bet`;
    if (last.action === 'raise') return `${pos} facing a ${street} raise to ${last.streetBb}bb`;
    return `${pos} facing a ${street} all-in`;
  }

  /** Plays villain actions until hero must act, the street's betting ends, or a live solve is awaited. */
  private advanceFlop(state: HandState): void {
    const pf = state.postflop!;
    for (;;) {
      if (pf.street !== 'flop' && !pf.live) return;
      const node = this.streetNode(pf);
      // No node: the street's betting is over (call, check-check or fold).
      if (!node) return this.nextStreet(state);
      const player = state.players.find((p) => p.position === pf.seats[node.player])!;
      if (player.isHero) {
        state.heroToAct = true;
        if (pf.street === 'flop' && this.liveStreets) this.predrawReplies(pf, node);
        return;
      }
      const h = this.seatHand(pf, node.player);
      let idx: number;
      let source: PostflopState['villainSource'] = null;
      if (this.jevPlays(state, player)) {
        // JEV AI decides: HandService asks it (`villainQuestion`) and hands the answer back (`applyVillainChoice`).
        if (!pf.villainChoice) return;
        idx = this.sample(pf.villainChoice);
        source = pf.villainSource ?? null;
        pf.villainChoice = null;
        pf.villainSource = null;
      } else {
        idx = pf.forced ?? this.sample(node.strategy.map((row) => row[h]));
        if (state.archetypes?.[player.position]) source = { by: 'solver' };
      }
      pf.forced = null;
      this.applyFlop(state, node, idx, source);
      if (player.folded) return this.finish(state);
    }
  }

  /**
   * After a street's betting: with live solving on and both players still with chips behind, the
   * turn is dealt and the hand waits for its solve (`attachLiveSolve`); the river comes with it.
   * Otherwise the board runs out.
   */
  private nextStreet(state: HandState): void {
    const pf = state.postflop!;
    // Only hands hero is still in get turn and river solves; bots left on their own just run out.
    const heroIn = state.players.some((p) => p.isHero && !p.folded);
    const canPlay = this.liveStreets && heroIn && pf.street !== 'river' && !state.players.some((p) => !p.folded && p.allIn);
    if (!canPlay) return this.finish(state);
    const committed = state.players.find((p) => !p.folded)!.committed;
    if (pf.street === 'flop') {
      pf.flopLine = pf.history;
      state.board.push(state.deck.shift()!);
      pf.street = 'turn';
    } else {
      pf.turnLine = pf.history;
      state.board.push(state.deck.shift()!);
      pf.street = 'river';
      if (!pf.live?.rivers.has(historyKey(pf.turnLine))) return this.runOut(state, 'The river strategy was missing from the solve, so the hand ran out.');
    }
    pf.history = [];
    pf.base = committed;
    pf.streetBets = {};
    this.advanceFlop(state);
  }

  /** Draws the bot's reply to each of hero's flop options now (same frequencies as drawing it later). */
  private predrawReplies(pf: PostflopState, node: FlopNode): void {
    if (pf.predraw) return;
    const predraw: Record<number, number> = {};
    node.actions.forEach((_, i) => {
      const next = pf.lookup.data.byHistory.get(historyKey([...pf.history, i]));
      if (!next) return;
      const h = pf.hands[next.player];
      predraw[i] = this.sample(next.strategy.map((row) => row[h]));
    });
    pf.predraw = predraw;
  }

  /** The hand is waiting for its turn (or, after a restart, river) solve. */
  awaitingSolve(state: HandState): boolean {
    const pf = state.postflop;
    return !!pf && pf.street !== 'flop' && !pf.live && !state.result;
  }

  /** An archetype opponent that JEV AI plays after the flop (with a key; otherwise the solver plays it). */
  private jevPlays(state: HandState, player: Player): boolean {
    return !player.isHero && !!state.archetypes?.[player.position] && this.archetypes.jevEnabled;
  }

  /** The hand is waiting for JEV AI's postflop decision for an archetype opponent. */
  awaitingVillain(state: HandState): boolean {
    if (state.free) {
      if (state.result || state.heroToAct || state.free.villainChoice) return false;
      const pos = this.freeToAct(state);
      return pos !== null && this.freeJev(state, state.players.find((p) => p.position === pos)!);
    }
    const pf = state.postflop;
    if (!pf || state.result || state.heroToAct || pf.villainChoice || this.awaitingSolve(state)) return false;
    const node = this.streetNode(pf);
    return !!node && this.jevPlays(state, state.players.find((p) => p.position === pf.seats[node.player])!);
  }

  /** The decision JEV AI is waiting to make: the board, the opponent's hand read, the betting and the options. */
  villainQuestion(state: HandState): PostflopQuestion | null {
    if (!this.awaitingVillain(state)) return null;
    if (state.free) return this.freeQuestion(state);
    const pf = state.postflop!;
    const node = this.streetNode(pf)!;
    const pos = pf.seats[node.player];
    const opponent = pf.seats[1 - node.player];
    const me = state.players.find((p) => p.position === pos)!;
    const myBet = pf.streetBets[pos] ?? 0;
    return buildPostflopQuestion({
      archetype: state.archetypes![pos]!,
      street: pf.street,
      board: state.board,
      cards: me.cards,
      position: pos,
      opponents: [opponent],
      inPosition: node.player === 1,
      potBb: round2(state.players.reduce((s, p) => s + p.committed, 0)),
      toCallBb: round2(Math.max(0, (pf.streetBets[opponent] ?? 0) - myBet)),
      behindBb: round2(this.effectiveStack(state) - me.committed),
      streetBetBb: myBet,
      actionLog: state.actionLog,
      actions: this.flopActions(pf, node),
    });
  }

  private freeQuestion(state: HandState): PostflopQuestion {
    const f = state.free!;
    const pos = this.freeToAct(state)!;
    const inHand = f.seats.filter((s) => !state.players.find((p) => p.position === s)!.folded);
    const me = state.players.find((p) => p.position === pos)!;
    const myBet = f.streetBets[pos] ?? 0;
    return buildPostflopQuestion({
      // A chart bot in a multiway pot plays as a solid regular.
      archetype: state.archetypes?.[pos] ?? 'tag',
      street: f.street,
      board: state.board,
      cards: me.cards,
      position: pos,
      opponents: inHand.filter((s) => s !== pos),
      inPosition: pos === inHand.at(-1),
      potBb: round2(state.players.reduce((s, p) => s + p.committed, 0)),
      toCallBb: round2(Math.max(0, this.freeTopBet(state, pos) - myBet)),
      behindBb: round2(this.effectiveStack(state) - me.committed),
      streetBetBb: myBet,
      actionLog: state.actionLog,
      actions: this.freeActionsFor(state),
    });
  }

  /**
   * JEV AI's answer for the pending decision (frequencies over the node's actions), or null when it
   * failed: the opponent then plays the solver strategy. Plays on to hero's next decision or the end.
   */
  applyVillainChoice(state: HandState, freqs: number[] | null, ms?: number): void {
    if (!this.awaitingVillain(state)) return;
    if (state.free) {
      const f = state.free;
      const actions = this.freeActionsFor(state);
      const ok = freqs && freqs.length === actions.length && freqs.some((x) => x > 0);
      const me = state.players.find((p) => p.position === this.freeToAct(state))!;
      f.villainChoice = ok ? freqs : ruleChoice(actions, me.cards, state.board);
      f.villainSource = ok ? { by: 'jev', ...(ms !== undefined && { ms }) } : { by: 'rules' };
      return this.advance(state);
    }
    const pf = state.postflop!;
    const node = this.streetNode(pf)!;
    const h = this.seatHand(pf, node.player);
    const valid = freqs && freqs.length === node.actions.length && freqs.some((f) => f > 0);
    pf.villainChoice = valid ? freqs : node.strategy.map((row) => row[h]);
    pf.villainSource = valid ? { by: 'jev', ...(ms !== undefined && { ms }) } : { by: 'solver' };
    this.advance(state);
  }

  /** The solve the hand is waiting for; null if it can't be built (then the hand runs out). */
  pendingSolve(state: HandState): LiveSolveJob | null {
    const pf = state.postflop;
    if (!pf || !this.awaitingSolve(state)) return null;
    // The river is dealt in advance: the next card of the deck, or already on the board after a restart.
    const river = state.board[4] ?? state.deck[0];
    return this.solveJob(state, pf.flopLine!, state.board[3], river);
  }

  /**
   * Turn solves worth starting while hero decides on the flop: for each of hero's options, the line
   * with the bot's pre-drawn reply, when that line reaches the turn. The turn and river cards are
   * already known from the deck.
   */
  speculativeSolves(state: HandState): LiveSolveJob[] {
    const pf = state.postflop;
    if (!pf || pf.street !== 'flop' || !state.heroToAct || !pf.predraw) return [];
    const node = this.streetNode(pf)!;
    const jobs: LiveSolveJob[] = [];
    node.actions.forEach((_, i) => {
      const line = [...pf.history, i];
      if (pf.predraw![i] !== undefined) line.push(pf.predraw![i]);
      // Another flop decision for hero still to come: that one gets its own speculation.
      if (pf.lookup.data.byHistory.has(historyKey(line))) return;
      const job = this.solveJob(state, line, state.deck[0], state.deck[1]);
      if (job) jobs.push(job);
    });
    return jobs;
  }

  private solveJob(state: HandState, line: number[], turn: string, river: string): LiveSolveJob | null {
    const pf = state.postflop!;
    const spot = this.flops?.spotInfo(pf.spot);
    if (!spot) return null;
    const solvedFlop = pf.lookup.data.flop.match(/../g)!;
    const mappedTurn = mapBoardCard(pf.lookup.mapper, turn, solvedFlop);
    const mappedRiver = mapBoardCard(pf.lookup.mapper, river, [...solvedFlop, mappedTurn]);
    const request = turnRequest(pf.lookup.data, spot, pf.spot, line, mappedTurn, mappedRiver, pf.hands);
    return request && { request, label: pf.spot };
  }

  /** The live solve arrived: play on from the turn (or the river, after a restart). */
  attachLiveSolve(state: HandState, solve: { id: string; commit: string; out: LiveOut }): void {
    const pf = state.postflop;
    if (!pf || !this.awaitingSolve(state)) return;
    const { out } = solve;
    const handIndexes: [Map<string, number>, Map<string, number>] = [handIndex(out.hands[0]), handIndex(out.hands[1])];
    const seatCards = (p: 0 | 1) => parseCards(state.players.find((x) => x.position === pf.seats[p])!.cards.join(''));
    const data: LiveData = {
      id: solve.id,
      board: out.board,
      hands: out.hands,
      handIndexes,
      turn: new Map(out.nodes.map((n) => [historyKey(n.history), n])),
      rivers: new Map(out.rivers.map((r) => [historyKey(r.turnLine), new Map(r.nodes.map((n) => [historyKey(n.history), n]))])),
      // Hands are translated like on the flop; one that clashes with the mapped turn card gets the closest hand in range.
      seatHands: [mapHand(seatCards(0), pf.lookup.mapper, out.hands[0], handIndexes[0]), mapHand(seatCards(1), pf.lookup.mapper, out.hands[1], handIndexes[1])],
      riverCards: new Map(out.rivers.map((r) => [historyKey(r.turnLine), r.card])),
      startRanges: this.liveStartRanges(pf, out),
      positions: [pf.seats[0], pf.seats[1]],
    };
    if (data.seatHands.some((h) => h < 0)) return this.runOut(state, 'A hand was missing from the turn solve, so the hand ran out.');
    this.recentLive.delete(data.id);
    this.recentLive.set(data.id, data);
    if (this.recentLive.size > 500) this.recentLive.delete(this.recentLive.keys().next().value!);
    pf.live = data;
    state.solverCommit = solve.commit;
    if (pf.street === 'river' && !data.rivers.has(historyKey(pf.turnLine!))) return this.runOut(state, 'The river strategy was missing from the solve, so the hand ran out.');
    this.advance(state);
  }

  /** Both ranges at the start of the turn, over the solve's hands: the flop file's ranges along the flop line. */
  private liveStartRanges(pf: PostflopState, out: LiveOut): [number[], number[]] | null {
    const spot = this.flops?.spotInfo(pf.spot);
    const start = spot && pf.flopLine && turnStart(pf.lookup.data, spot, pf.flopLine);
    if (!start) return null;
    return [0, 1].map((p) => out.hands[p].map((h) => start.ranges[p][pf.lookup.data.handIndexes[p].get(h) ?? -1] ?? 0)) as [number[], number[]];
  }

  /**
   * Both ranges at a decision, for the coach: hero's with its strategy and EVs, and villain's when
   * it's known (`villain` is the last raiser, for preflop decisions). Null when the node's data
   * is gone (a live solve no longer in memory).
   */
  spotRanges(nodeKey: string, villain?: VillainRange | null): SpotRanges | null {
    const live = this.liveNode(nodeKey);
    if (live) {
      const { key, data, node } = live;
      const p = node.player;
      const river = key.street === 'river';
      const turnLine = key.turnLine ? key.turnLine.split('.').map(Number) : [];
      const history = key.history ? key.history.split('.').map(Number) : [];
      let reach = data.startRanges && (river ? lineReach(data.turn, data.startRanges, turnLine) : data.startRanges);
      if (reach) reach = lineReach(river ? data.rivers.get(key.turnLine)! : data.turn, reach, history);
      return {
        source: 'solver',
        board: river ? [...data.board, data.riverCards.get(key.turnLine)!] : data.board,
        actions: node.actions.map((a) => parseSolverAction(a).label),
        hero: { hands: data.hands[p], weights: node.weights ?? data.hands[p].map(() => 1), strategy: node.strategy.map((row) => row.map((f) => f / 1000)), ev: node.ev_bb ?? null },
        villain: reach ? { position: data.positions[1 - p], hands: data.hands[1 - p], weights: reach[1 - p] } : null,
      };
    }
    const flop = parseFlopNodeKey(nodeKey);
    if (flop) {
      if (!this.flops?.solvedFlops(flop.spot).includes(flop.flop)) return null;
      const { data, node } = this.solvedNode(flop);
      const p = node.player;
      const spot = this.flops.spotInfo(flop.spot);
      const reach = spot && lineReach(data.byHistory, preflopRanges(data, spot), flop.history);
      // Spot names are "<a>_vs_<b>_...": whichever acts first after the flop is OOP.
      const seats = flop.spot.split('_vs_').map((s) => s.split('_')[0].toUpperCase() as Position);
      const [oop, ip] = postflopIndex(seats[0]) < postflopIndex(seats[1]) ? seats : [seats[1], seats[0]];
      return {
        source: 'solver',
        board: data.flop.match(/../g)!,
        actions: node.actions.map((a) => parseSolverAction(a).label),
        hero: { hands: data.hands[p], weights: node.weights ?? data.hands[p].map(() => 1), strategy: node.strategy.map((row) => row.map((f) => f / 1000)), ev: node.ev_bb ?? null },
        villain: reach ? { position: [oop, ip][1 - p], hands: data.hands[1 - p], weights: reach[1 - p] } : null,
      };
    }
    if (nodeKey.startsWith(`${LIVE_KEY}|`) || !this.charts.hasNode(nodeKey)) return null;
    const node = this.charts.getNode(nodeKey);
    const vNode = villain && this.charts.hasNode(villain.nodeKey) ? this.charts.getNode(villain.nodeKey) : null;
    const vIdx = vNode ? vNode.actions.findIndex((a) => a.id === villain!.actionId) : -1;
    return {
      source: 'chart',
      board: [],
      actions: node.actions.map((a) => a.label),
      hero: {
        hands: ALL_HAND_CLASSES,
        weights: ALL_HAND_CLASSES.map(comboCount),
        strategy: node.actions.map((_, a) => ALL_HAND_CLASSES.map((hc) => node.strategy.get(hc)![a])),
        ev: node.actions.map((_, a) => ALL_HAND_CLASSES.map((hc) => node.ev.get(hc)?.[a] ?? null)),
      },
      villain: vNode && vIdx >= 0 ? { position: villain!.position, hands: ALL_HAND_CLASSES, weights: ALL_HAND_CLASSES.map((hc) => comboCount(hc) * vNode.strategy.get(hc)![vIdx]) } : null,
    };
  }

  /** The live solve failed or was too slow: the board runs out as before, and the player is told why. */
  runOut(state: HandState, note: string): void {
    if (state.result) return;
    state.liveNote = note;
    this.finish(state);
  }

  private liveNode(nodeKey: string): { key: NonNullable<ReturnType<typeof parseLiveNodeKey>>; data: LiveData; node: FlopNode } | null {
    const key = parseLiveNodeKey(nodeKey);
    const data = key && this.recentLive.get(key.id);
    if (!key || !data) return null;
    const nodes = key.street === 'turn' ? data.turn : data.rivers.get(key.turnLine);
    const node = nodes?.get(key.history);
    return node ? { key, data, node } : null;
  }

  private applyFlop(state: HandState, node: FlopNode, idx: number, source: PostflopState['villainSource'] = null): void {
    const pf = state.postflop!;
    const pos = pf.seats[node.player];
    const player = state.players.find((p) => p.position === pos)!;
    const action = this.flopActions(pf, node)[idx];
    let street = pf.streetBets[pos] ?? 0;
    // Bets are capped at the effective stack: a bigger stack's chips beyond it can't be called.
    const effective = this.effectiveStack(state);
    if (action.id === 'fold') player.folded = true;
    else if (action.id !== 'check') street = Math.min(action.toBb!, effective - pf.base);
    pf.streetBets[pos] = street;
    player.committed = round2(pf.base + street);
    if (player.committed >= effective) player.allIn = true;
    pf.history.push(idx);
    state.actionLog.push({
      position: pos,
      action: action.id,
      toBb: player.committed,
      isHero: player.isHero,
      street: pf.street,
      streetBb: street,
      ...(source && { decidedBy: source.by }),
      ...(source?.ms !== undefined && { jevMs: source.ms }),
    });
  }

  private finish(state: HandState): void {
    const live = state.players.filter((p) => !p.folded);
    const returned: Partial<Record<Position, number>> = {};
    if (live.length > 1) {
      // A shorter stack called all in for less: the bigger stack's chips nobody matched go back.
      const [top, next] = [...state.players].sort((a, b) => b.committed - a.committed);
      if (top.committed > next.committed) {
        returned[top.position] = round2(top.committed - next.committed);
        top.committed = next.committed;
      }
    }
    const pot = round2(state.players.reduce((s, p) => s + p.committed, 0));
    const hero = state.players.find((p) => p.isHero)!;
    let board: string[] = [...state.board];
    let showdown: HandResult['showdown'] = null;
    let winners: Position[];
    let summary: string;
    const won: Partial<Record<Position, number>> = {};

    if (live.length === 1) {
      winners = [live[0].position];
      won[live[0].position] = pot;
      summary = `${live[0].position} wins ${pot}bb uncontested.`;
    } else {
      const outcome = this.resolver.resolve(
        live.map((p) => ({ position: p.position, cards: p.cards })),
        state.deck,
        state.board,
      );
      board = outcome.board;
      showdown = outcome.entries;
      state.showdownPositions = live.map((p) => p.position);
      const hands = new Map(live.map((p) => [p.position, bestHand([...p.cards, ...board])]));
      const pots = sidePots(state.players, live);
      winners = [];
      summary = '';
      pots.forEach(({ amount, eligible }, i) => {
        const top = eligible.reduce((a, b) => (compareScores(hands.get(b)!.score, hands.get(a)!.score) > 0 ? b : a));
        const ws = eligible.filter((p) => compareScores(hands.get(p)!.score, hands.get(top)!.score) === 0);
        for (const w of ws) won[w] = round2((won[w] ?? 0) + amount / ws.length);
        const hand = hands.get(ws[0])!.name.toLowerCase();
        if (i === 0) {
          winners = ws;
          summary = ws.length === 1 ? `${ws[0]} wins ${amount}bb at showdown with ${hand}.` : `${ws.join(' and ')} split ${amount}bb with ${hand}.`;
        } else if (eligible.length === 1) {
          summary += ` ${ws[0]} also takes the ${amount}bb side pot the all-in stack couldn't cover.`;
        } else {
          summary += ws.length === 1 ? ` ${ws[0]} wins the ${amount}bb side pot with ${hand}.` : ` ${ws.join(' and ')} split the ${amount}bb side pot with ${hand}.`;
        }
      });
      // The entries mark the main pot's winners, as `winners` does.
      for (const e of showdown) e.isWinner = winners.includes(e.position);
    }
    state.result = {
      board,
      showdown,
      winners,
      potBb: pot,
      heroNetBb: round2((won[hero.position] ?? 0) - hero.committed),
      summary,
      foldReveal: hero.folded ? this.foldReveal(state, board) : null,
      won,
      ...(Object.keys(returned).length && { returned }),
    };
    state.heroToAct = false;
  }

  /** The bet or raise hero folded to: who made it, with their cards. */
  private foldReveal(state: HandState, board: string[]): HandResult['foldReveal'] {
    const fold = state.actionLog.findIndex((a) => a.isHero && a.action === 'fold');
    const to = state.actionLog
      .slice(0, Math.max(fold, 0))
      .reverse()
      .find((a) => !a.isHero && (a.action === 'bet' || a.action === 'raise' || a.action === 'allin'));
    if (fold < 0 || !to) return null;
    const cards = [...state.players.find((p) => p.position === to.position)!.cards];
    return { position: to.position, cards, handName: board.length >= 3 ? bestHand([...cards, ...board]).name : null };
  }
}
