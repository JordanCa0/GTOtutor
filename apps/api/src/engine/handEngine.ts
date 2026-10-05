import { randomUUID } from 'node:crypto';
import {
  SIX_MAX_POSITIONS,
  type ActionLogEntry,
  type ActionOption,
  type ActionType,
  type ChartNodeView,
  type DecisionFeedback,
  type Grade,
  type HandConfig,
  type HandResult,
  type HandView,
  type LegalAction,
  type Position,
  type StartHandRequest,
  type Street,
} from '@gtotutor/shared-types';
import type { ChartService } from '../charts/chartService.js';
import type { ChartNode } from '../charts/types.js';
import { FACING_TYPES, makeNodeKey } from '../charts/nodeKeys.js';
import { fullDeck, handClass, shuffle } from '../poker/cards.js';
import { flopClassStrategy, flopRangeSummary, historyKey, parseSolverAction, type FlopLookup, type FlopNode, type FlopStore, type LoadedFlop } from '../postflop/flopStore.js';
import type { Rng } from '../poker/rng.js';
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
  config: HandConfig;
  heroPosition: Position;
  players: Player[];
  deck: string[];
  currentBet: number;
  raiseLevel: number;
  opener: Position | null;
  lastRaiser: Position | null;
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
  /** Dealt in flop practice mode (straight to a BTN vs BB flop). */
  flopPractice: boolean;
}

/** A hand as stored in the database: the flop's solved data is looked up again on restore. */
export type StoredHandState = Omit<HandState, 'postflop'> & {
  postflop: Pick<PostflopState, 'spot' | 'seats' | 'history' | 'base' | 'streetBets'> | null;
};

/** A heads-up flop played from solver output (`solver/output/<spot>`). */
interface PostflopState {
  spot: string;
  lookup: FlopLookup;
  /** [OOP, IP]: solver player 0 and 1. */
  seats: [Position, Position];
  /** Each seat's hand, as an index into the solved file's hand list. */
  hands: [number, number];
  /** Action indexes taken so far on the flop. */
  history: number[];
  /** What each player had in when the flop came. */
  base: number;
  streetBets: Partial<Record<Position, number>>;
}

const FLOP_KEY = 'FLOP';
export const isFlopNodeKey = (nodeKey: string) => nodeKey.startsWith(`${FLOP_KEY}|`);

export function parseFlopNodeKey(nodeKey: string): { spot: string; flop: string; history: number[] } | null {
  const [kind, spot, flop, history] = nodeKey.split('|');
  if (kind !== FLOP_KEY || !spot || !flop || history === undefined) return null;
  if (!/^[a-z0-9_]+$/.test(spot) || !/^([2-9TJQKA][cdhs]){3}$/.test(flop) || !/^(\d+(\.\d+)*)?$/.test(history)) return null;
  return { spot, flop, history: history ? history.split('.').map(Number) : [] };
}

/** Postflop acting order: SB, BB, then UTG..BTN. */
const postflopIndex = (p: Position) => ['SB', 'BB', 'UTG', 'HJ', 'CO', 'BTN'].indexOf(p);

const round2 = (x: number) => Math.round(x * 100) / 100;
const MIXED_THRESHOLD = 0.1;
const MAX_DEAL_ATTEMPTS = 200;
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
  ) {}

  start(req: StartHandRequest): HandState {
    if (req.tableSize !== 'SIX_MAX' || req.stackDepthBb !== 100) {
      throw new HttpError(400, 'Only 6-max at 100bb is available in this version.');
    }
    if (req.heroPosition !== 'random' && !SIX_MAX_POSITIONS.includes(req.heroPosition)) {
      throw new HttpError(400, `Unknown position ${req.heroPosition}`);
    }
    if (req.flopPractice) return this.startFlopPractice(req);
    const skipEasyFolds = (req.skipEasyFolds ?? true) && this.rng.float() >= UNFILTERED_DEAL_RATE;
    // Redeal hands with nothing to train on: walks in the BB, and (mostly) trivial folds.
    for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS; attempt++) {
      const state = this.deal(req);
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
      const state = this.deal({ ...req, heroPosition });
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
    if (!state.heroToAct) return null;
    const hero = state.players.find((p) => p.isHero)!;
    const hc = handClass(hero.cards[0], hero.cards[1]);
    if (state.postflop) {
      const pf = state.postflop;
      const node = this.flopNode(pf)!;
      const h = pf.hands[node.player];
      const actions = this.flopActions(pf, node);
      return {
        nodeKey: [FLOP_KEY, pf.spot, pf.lookup.data.flop, historyKey(pf.history)].join('|'),
        nodeLabel: this.flopLabel(state, hero.position),
        street: 'flop',
        actions,
        heroCards: [...hero.cards],
        handClass: hc,
        options: actions.map((a, i) => ({
          actionId: a.id,
          label: a.label,
          frequency: node.strategy[i][h] / 1000,
          evBb: node.ev_bb ? node.ev_bb[i][h] : null,
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
      options: node.actions.map((a, i) => ({ actionId: a.id, label: legal[i].label, frequency: freqs[i], evBb: evs[i] })),
      approxFlop: null,
    };
  }

  /** Share of the whole range taking each action at a node, for the coach. */
  rangeSummary(nodeKey: string): { label: string; share: number }[] {
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

  /** A flop node as a 13x13 strategy view (averaged per hand class over the solved flop). */
  flopChartView(nodeKey: string): ChartNodeView | null {
    const flop = parseFlopNodeKey(nodeKey);
    if (!flop || !this.flops?.solvedFlops(flop.spot).includes(flop.flop)) return null;
    const { data, node } = this.solvedNode(flop);
    return {
      nodeKey,
      label: `Flop ${flop.flop}${flop.history.length ? '' : ', first decision'} (solver, ${flop.spot.replaceAll('_', ' ')})`,
      actions: node.actions.map(parseSolverAction),
      strategy: flopClassStrategy(data, node),
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
      postflop: postflop && { spot: postflop.spot, seats: postflop.seats, history: postflop.history, base: postflop.base, streetBets: postflop.streetBets },
    });
  }

  restore(stored: StoredHandState): HandState {
    const { postflop, ...rest } = structuredClone(stored);
    if (!postflop) return { ...rest, postflop: null };
    const lookup = this.flops?.lookup(postflop.spot, rest.board);
    if (!lookup) throw new HttpError(410, 'The solved flop data for this hand is no longer available.');
    const cards = (pos: Position) => rest.players.find((p) => p.position === pos)!.cards;
    return {
      ...rest,
      postflop: { ...postflop, lookup, hands: [this.flops!.handFor(lookup, 0, cards(postflop.seats[0])), this.flops!.handFor(lookup, 1, cards(postflop.seats[1]))] },
    };
  }

  markHintUsed(state: HandState): void {
    if (state.heroToAct) state.hintUsedPending = true;
  }

  decide(state: HandState, action: ActionType): DecisionFeedback {
    const pending = this.pendingDecision(state);
    if (!pending) throw new HttpError(409, 'It is not your turn — this hand is complete.');
    const { options } = pending;
    const chosenIdx = pending.actions.findIndex((a) => a.id === action);
    if (chosenIdx < 0) throw new HttpError(400, `Illegal action "${action}" here.`);

    const maxFreq = Math.max(...options.map((o) => o.frequency));
    const chosenFrequency = options[chosenIdx].frequency;
    const grade: Grade =
      chosenFrequency >= maxFreq - 1e-9 ? 'best' : chosenFrequency >= MIXED_THRESHOLD ? 'mixed' : 'mistake';

    const feedback: DecisionFeedback = {
      id: `${state.id}-d${state.decisions.length + 1}`,
      nodeKey: pending.nodeKey,
      nodeLabel: pending.nodeLabel,
      heroCards: pending.heroCards,
      handClass: pending.handClass,
      chosenAction: action,
      options,
      chosenFrequency,
      bestAction: options.find((o) => o.frequency === maxFreq)!.actionId,
      grade,
      hintUsed: state.hintUsedPending,
      street: pending.street,
      board: [...state.board],
      approxFlop: pending.approxFlop,
    };
    state.hintUsedPending = false;
    state.decisions.push(feedback);
    if (state.postflop) {
      this.applyFlop(state, this.flopNode(state.postflop)!, chosenIdx);
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
    const stack = state.config.stackDepthBb;
    const complete = state.result !== null;
    const pending = this.pendingDecision(state);
    return {
      id: state.id,
      config: state.config,
      heroPosition: state.heroPosition,
      heroCards: state.players.find((p) => p.isHero)!.cards,
      seats: state.players.map((p) => ({
        position: p.position,
        isHero: p.isHero,
        stackBb: round2(stack - p.committed),
        committedBb: p.committed,
        folded: p.folded,
        allIn: p.allIn,
        cards: p.isHero || (complete && state.showdownPositions.includes(p.position)) ? p.cards : null,
      })),
      potBb: round2(state.players.reduce((s, p) => s + p.committed, 0)),
      board: state.board,
      actionLog: state.actionLog,
      legalActions: pending ? pending.options.map((o, i) => ({ ...pending.actions[i], label: o.label })) : [],
      pendingSpot: pending && { nodeKey: pending.nodeKey, nodeLabel: pending.nodeLabel, handClass: pending.handClass, street: pending.street },
      status: complete ? 'complete' : 'awaiting_hero',
      decisions: state.decisions,
      result: state.result,
      dataSource: this.charts.dataSource,
    };
  }

  private deal(req: StartHandRequest): HandState {
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
      config: { tableSize: req.tableSize, stackDepthBb: req.stackDepthBb },
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

  /** Normalizes the live action history into a chart lookup key (2-player subgame abstraction). */
  private nodeKeyFor(state: HandState, player: Player): string {
    const { tableSize, stackDepthBb } = state.config;
    const pos = player.position;
    if (state.raiseLevel === 0) {
      // The BB only acts in an unraised pot after the SB limps.
      return pos === 'BB' ? makeNodeKey(tableSize, stackDepthBb, 'VS_LIMP', pos, state.limper!) : makeNodeKey(tableSize, stackDepthBb, 'RFI', pos);
    }
    if (state.raiseLevel === 1) {
      return pos === state.limper
        ? makeNodeKey(tableSize, stackDepthBb, 'VS_ISO', pos, state.opener!)
        : makeNodeKey(tableSize, stackDepthBb, 'VS_OPEN', pos, state.opener!);
    }
    const types = FACING_TYPES[state.raiseLevel];
    return pos === state.prevRaiser
      ? makeNodeKey(tableSize, stackDepthBb, types.direct, pos, state.lastRaiser!)
      : makeNodeKey(tableSize, stackDepthBb, types.cold, pos);
  }

  private legalActions(state: HandState, player: Player): LegalAction[] {
    const node = this.charts.getNode(this.nodeKeyFor(state, player));
    const callTo = Math.min(state.currentBet, state.config.stackDepthBb);
    const callLabel = state.raiseLevel === 0 ? 'Limp' : callTo >= state.config.stackDepthBb ? `Call all-in ${callTo}` : `Call ${callTo}`;
    return node.actions.map((a) => (a.id === 'call' ? { ...a, label: callLabel, toBb: callTo } : a));
  }

  private apply(state: HandState, player: Player, action: LegalAction): void {
    const stack = state.config.stackDepthBb;
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
      toBb = action.id === 'allin' ? stack : Math.min(action.toBb!, stack);
      player.committed = toBb;
      state.currentBet = toBb;
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
      if (state.postflop) return this.advanceFlop(state);
      const idx = this.nextToActIndex(state);
      if (idx === null) {
        if (this.startFlop(state)) continue;
        return this.finish(state);
      }
      const player = state.players[idx];
      if (player.isHero) {
        state.heroToAct = true;
        return;
      }
      const node = this.charts.getNode(this.nodeKeyFor(state, player));
      const freqs = node.strategy.get(handClass(player.cards[0], player.cards[1]))!;
      this.apply(state, player, node.actions[this.sample(freqs)]);
    }
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
    const suffix = state.config.stackDepthBb;
    if (state.limper) {
      const kind = ['limp', 'iso', 'l3b'][state.raiseLevel];
      return kind ? `sb_vs_bb_${kind}_${suffix}` : null;
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

  /** Deals the flop and starts solver-driven flop play when this spot has solved flops. */
  private startFlop(state: HandState): boolean {
    if (!this.flops || state.postflop || state.board.length) return false;
    const live = state.players.filter((p) => !p.folded);
    if (live.some((p) => p.allIn)) return false;
    const spot = this.spotName(state);
    if (!spot || this.flops.solvedFlops(spot).length === 0) return false;
    state.board = state.deck.splice(0, 3);
    const lookup = this.flops.lookup(spot, state.board);
    // A flop shape with no solved example: the board stays and the hand runs out as before.
    if (!lookup) return false;
    const seats = [...live].sort((a, b) => postflopIndex(a.position) - postflopIndex(b.position));
    state.postflop = {
      spot,
      lookup,
      seats: [seats[0].position, seats[1].position],
      hands: [this.flops.handFor(lookup, 0, seats[0].cards), this.flops.handFor(lookup, 1, seats[1].cards)],
      history: [],
      base: live[0].committed,
      streetBets: {},
    };
    return true;
  }

  private flopNode(pf: PostflopState): FlopNode | undefined {
    return pf.lookup.data.byHistory.get(historyKey(pf.history));
  }

  /** The node's actions with amounts for the table (a call shows what it calls). */
  private flopActions(pf: PostflopState, node: FlopNode): LegalAction[] {
    const facing = pf.streetBets[pf.seats[1 - node.player]] ?? 0;
    return node.actions.map(parseSolverAction).map((a) => (a.id === 'call' ? { ...a, label: `Call ${facing}`, toBb: facing } : a));
  }

  private flopLabel(state: HandState, pos: Position): string {
    const prior = state.actionLog.filter((a) => a.street === 'flop');
    const last = prior.at(-1);
    if (!last) return `${pos} first to act on the flop`;
    if (last.action === 'check') return `${pos} on the flop after ${last.position} checks`;
    if (last.action === 'bet') return `${pos} facing a ${last.streetBb}bb flop bet`;
    if (last.action === 'raise') return `${pos} facing a flop raise to ${last.streetBb}bb`;
    return `${pos} facing a flop all-in`;
  }

  /** Plays villain flop actions until hero must act or the flop betting ends. */
  private advanceFlop(state: HandState): void {
    const pf = state.postflop!;
    for (;;) {
      const node = this.flopNode(pf);
      // No node: the flop betting is over (call, check-check or fold).
      if (!node) return this.finish(state);
      const player = state.players.find((p) => p.position === pf.seats[node.player])!;
      if (player.isHero) {
        state.heroToAct = true;
        return;
      }
      const h = pf.hands[node.player];
      this.applyFlop(state, node, this.sample(node.strategy.map((row) => row[h])));
      if (player.folded) return this.finish(state);
    }
  }

  private applyFlop(state: HandState, node: FlopNode, idx: number): void {
    const pf = state.postflop!;
    const pos = pf.seats[node.player];
    const player = state.players.find((p) => p.position === pos)!;
    const action = this.flopActions(pf, node)[idx];
    let street = pf.streetBets[pos] ?? 0;
    if (action.id === 'fold') player.folded = true;
    else if (action.id !== 'check') street = Math.min(action.toBb!, state.config.stackDepthBb - pf.base);
    pf.streetBets[pos] = street;
    player.committed = round2(pf.base + street);
    if (player.committed >= state.config.stackDepthBb) player.allIn = true;
    pf.history.push(idx);
    state.actionLog.push({ position: pos, action: action.id, toBb: player.committed, isHero: player.isHero, street: 'flop', streetBb: street });
  }

  private finish(state: HandState): void {
    const pot = round2(state.players.reduce((s, p) => s + p.committed, 0));
    const live = state.players.filter((p) => !p.folded);
    const hero = state.players.find((p) => p.isHero)!;
    let board: string[] = [...state.board];
    let showdown: HandResult['showdown'] = null;
    let winners: Position[];
    let summary: string;

    if (live.length === 1) {
      winners = [live[0].position];
      summary = `${live[0].position} wins ${pot}bb uncontested.`;
    } else {
      const outcome = this.resolver.resolve(
        live.map((p) => ({ position: p.position, cards: p.cards })),
        state.deck,
        state.board,
      );
      board = outcome.board;
      showdown = outcome.entries;
      winners = outcome.winners;
      state.showdownPositions = live.map((p) => p.position);
      const winningHand = outcome.entries.find((e) => e.isWinner)!.handName.toLowerCase();
      summary =
        winners.length === 1
          ? `${winners[0]} wins ${pot}bb at showdown with ${winningHand}.`
          : `${winners.join(' and ')} split ${pot}bb with ${winningHand}.`;
    }

    const heroWon = winners.includes(hero.position) ? pot / winners.length : 0;
    state.result = {
      board,
      showdown,
      winners,
      potBb: pot,
      heroNetBb: round2(heroWon - hero.committed),
      summary,
    };
    state.heroToAct = false;
  }
}
