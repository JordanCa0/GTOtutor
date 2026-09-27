import { randomUUID } from 'node:crypto';
import {
  SIX_MAX_POSITIONS,
  type ActionLogEntry,
  type ActionType,
  type DecisionFeedback,
  type Grade,
  type HandConfig,
  type HandResult,
  type HandView,
  type LegalAction,
  type Position,
  type StartHandRequest,
} from '@gtotutor/shared-types';
import type { ChartService } from '../charts/chartService.js';
import { FACING_TYPES, makeNodeKey } from '../charts/nodeKeys.js';
import { fullDeck, handClass, shuffle } from '../poker/cards.js';
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
  config: HandConfig;
  heroPosition: Position;
  players: Player[];
  deck: string[];
  currentBet: number;
  raiseLevel: number;
  opener: Position | null;
  lastRaiser: Position | null;
  prevRaiser: Position | null;
  lastActorIndex: number;
  heroToAct: boolean;
  actionLog: ActionLogEntry[];
  decisions: DecisionFeedback[];
  showdownPositions: Position[];
  result: HandResult | null;
}

const round2 = (x: number) => Math.round(x * 100) / 100;
const MIXED_THRESHOLD = 0.1;
const MAX_DEAL_ATTEMPTS = 20;

export class HandEngine {
  constructor(
    private readonly charts: ChartService,
    private readonly rng: Rng,
    private readonly resolver: ShowdownResolver,
  ) {}

  start(req: StartHandRequest): HandState {
    if (req.tableSize !== 'SIX_MAX' || req.stackDepthBb !== 100) {
      throw new HttpError(400, 'Only 6-max at 100bb is available in this version.');
    }
    if (req.heroPosition !== 'random' && !SIX_MAX_POSITIONS.includes(req.heroPosition)) {
      throw new HttpError(400, `Unknown position ${req.heroPosition}`);
    }
    // A hand where everyone folds to hero in the BB has no decision to train on — redeal.
    for (let attempt = 0; attempt < MAX_DEAL_ATTEMPTS; attempt++) {
      const state = this.deal(req);
      this.advance(state);
      if (state.heroToAct) return state;
    }
    throw new HttpError(500, 'Could not deal a hand with a hero decision.');
  }

  decide(state: HandState, action: ActionType): DecisionFeedback {
    if (!state.heroToAct) throw new HttpError(409, 'It is not your turn — this hand is complete.');
    const hero = state.players[this.nextToActIndex(state)!];
    const node = this.charts.getNode(this.nodeKeyFor(state, hero));
    const chosenIdx = node.actions.findIndex((a) => a.id === action);
    if (chosenIdx < 0) throw new HttpError(400, `Illegal action "${action}" here.`);

    const hc = handClass(hero.cards[0], hero.cards[1]);
    const freqs = node.strategy.get(hc)!;
    const evs = node.ev.get(hc)!;
    const maxFreq = Math.max(...freqs);
    const chosenFrequency = freqs[chosenIdx];
    const grade: Grade =
      chosenFrequency >= maxFreq - 1e-9 ? 'best' : chosenFrequency >= MIXED_THRESHOLD ? 'mixed' : 'mistake';
    const legal = this.legalActions(state, hero);

    const feedback: DecisionFeedback = {
      id: `${state.id}-d${state.decisions.length + 1}`,
      nodeKey: node.nodeKey,
      nodeLabel: node.label,
      heroCards: [...hero.cards],
      handClass: hc,
      chosenAction: action,
      options: node.actions.map((a, i) => ({
        actionId: a.id,
        label: legal[i].label,
        frequency: freqs[i],
        evBb: evs[i],
      })),
      chosenFrequency,
      bestAction: node.actions[freqs.indexOf(maxFreq)].id,
      grade,
    };
    state.decisions.push(feedback);
    this.apply(state, hero, node.actions[chosenIdx]);
    this.advance(state);
    return feedback;
  }

  view(state: HandState): HandView {
    const stack = state.config.stackDepthBb;
    const complete = state.result !== null;
    const heroIdx = state.heroToAct ? this.nextToActIndex(state) : null;
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
      actionLog: state.actionLog,
      legalActions: heroIdx === null ? [] : this.legalActions(state, state.players[heroIdx]),
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
      config: { tableSize: req.tableSize, stackDepthBb: req.stackDepthBb },
      heroPosition,
      players,
      deck,
      currentBet: 1,
      raiseLevel: 0,
      opener: null,
      lastRaiser: null,
      prevRaiser: null,
      lastActorIndex: players.length - 1,
      heroToAct: false,
      actionLog: [],
      decisions: [],
      showdownPositions: [],
      result: null,
    };
  }

  /** Normalizes the live action history into a chart lookup key (2-player subgame abstraction). */
  private nodeKeyFor(state: HandState, player: Player): string {
    const { tableSize, stackDepthBb } = state.config;
    const pos = player.position;
    if (state.raiseLevel === 0) return makeNodeKey(tableSize, stackDepthBb, 'RFI', pos);
    if (state.raiseLevel === 1) return makeNodeKey(tableSize, stackDepthBb, 'VS_OPEN', pos, state.opener!);
    const types = FACING_TYPES[state.raiseLevel];
    return pos === state.prevRaiser
      ? makeNodeKey(tableSize, stackDepthBb, types.direct, pos, state.lastRaiser!)
      : makeNodeKey(tableSize, stackDepthBb, types.cold, pos);
  }

  private legalActions(state: HandState, player: Player): LegalAction[] {
    const node = this.charts.getNode(this.nodeKeyFor(state, player));
    const callTo = Math.min(state.currentBet, state.config.stackDepthBb);
    return node.actions.map((a) =>
      a.id === 'call' ? { ...a, label: callTo >= state.config.stackDepthBb ? `Call all-in ${callTo}` : `Call ${callTo}`, toBb: callTo } : a,
    );
  }

  private apply(state: HandState, player: Player, action: LegalAction): void {
    const stack = state.config.stackDepthBb;
    let toBb = player.committed;
    if (action.id === 'fold') {
      player.folded = true;
    } else if (action.id === 'call') {
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
    state.actionLog.push({ position: player.position, action: action.id, toBb, isHero: player.isHero });
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
      const idx = this.nextToActIndex(state);
      if (idx === null) return this.finish(state);
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

  private finish(state: HandState): void {
    const pot = round2(state.players.reduce((s, p) => s + p.committed, 0));
    const live = state.players.filter((p) => !p.folded);
    const hero = state.players.find((p) => p.isHero)!;
    let board: string[] = [];
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

export class HandStore {
  private readonly hands = new Map<string, HandState>();
  constructor(private readonly maxHands = 5000) {}

  save(state: HandState): void {
    this.hands.delete(state.id);
    this.hands.set(state.id, state);
    if (this.hands.size > this.maxHands) this.hands.delete(this.hands.keys().next().value!);
  }

  get(id: string): HandState {
    const state = this.hands.get(id);
    if (!state) throw new HttpError(404, 'Hand not found (it may have expired).');
    return state;
  }
}
