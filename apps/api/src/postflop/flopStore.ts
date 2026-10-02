import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ActionType, LegalAction } from '@gtotutor/shared-types';
import { handClass } from '../poker/cards.js';
import { CardMapper, handIndex, mapHand, nearestFlop, parseCards } from './flopMap.js';

/** One flop decision from the solver (see solver/README.md for the file format). */
export interface FlopNode {
  history: number[];
  player: 0 | 1;
  actions: string[];
  /** Per action, per hand: frequency in permille. */
  strategy: number[][];
  /** Newer solver output only. */
  weights?: number[];
  ev_bb?: number[][];
}

export interface FlopFile {
  spot: string;
  flop: string;
  hands: [string[], string[]];
  nodes: FlopNode[];
}

export interface LoadedFlop extends FlopFile {
  byHistory: Map<string, FlopNode>;
  handIndexes: [Map<string, number>, Map<string, number>];
}

/** A real flop resolved to solved data: the file, and how to translate hands onto it. */
export interface FlopLookup {
  data: LoadedFlop;
  mapper: CardMapper;
  /** The solved flop used when it differs from the real one, else null. */
  approxFlop: string | null;
}

export const historyKey = (h: number[]) => h.join('.');

/** "bet 1.8" -> a legal action whose `toBb` is the street total after acting. */
export function parseSolverAction(label: string): LegalAction {
  const [kind, amount] = label.split(' ');
  const toBb = amount === undefined ? null : Number(amount);
  const id = (kind === 'allin' ? 'allin' : kind) as ActionType;
  const text: Record<string, string> = {
    fold: 'Fold',
    check: 'Check',
    call: 'Call',
    bet: `Bet ${toBb}`,
    raise: `Raise to ${toBb}`,
    allin: `All-in ${toBb}`,
  };
  return { id, label: text[kind] ?? label, toBb };
}

/** Reads `solver/output/<spot>/<flop>.json` files, keeping recently used flops in memory. */
export class FlopStore {
  private readonly lists = new Map<string, string[]>();
  private readonly cache = new Map<string, LoadedFlop>();

  constructor(
    private readonly root: string,
    private readonly maxCached = 64,
  ) {}

  /** Solved flop names for a spot (empty when the spot has no solver output). */
  solvedFlops(spot: string): string[] {
    let list = this.lists.get(spot);
    if (!list) {
      const dir = join(this.root, spot);
      list = existsSync(dir) ? readdirSync(dir).filter((f) => /^([2-9TJQKA][cdhs]){3}\.json$/.test(f)).map((f) => f.slice(0, 6)) : [];
      this.lists.set(spot, list);
    }
    return list;
  }

  load(spot: string, flop: string): LoadedFlop {
    const key = `${spot}/${flop}`;
    let data = this.cache.get(key);
    if (data) {
      this.cache.delete(key);
    } else {
      const file = JSON.parse(readFileSync(join(this.root, spot, `${flop}.json`), 'utf8')) as FlopFile;
      data = {
        ...file,
        byHistory: new Map(file.nodes.map((n) => [historyKey(n.history), n])),
        handIndexes: [handIndex(file.hands[0]), handIndex(file.hands[1])],
      };
    }
    this.cache.set(key, data);
    if (this.cache.size > this.maxCached) this.cache.delete(this.cache.keys().next().value!);
    return data;
  }

  /** The solved data for a real flop, or null when the spot (or this flop shape) has none. */
  lookup(spot: string, board: string[]): FlopLookup | null {
    const real = parseCards(board.join(''));
    const nearest = nearestFlop(real, this.solvedFlops(spot));
    if (!nearest) return null;
    return {
      data: this.load(spot, nearest.flop),
      mapper: new CardMapper(real, parseCards(nearest.flop)),
      approxFlop: nearest.distance > 0 ? nearest.flop : null,
    };
  }

  /** Index of a real hand (e.g. ["As", "Kd"]) in the solved file's hand list for `player`. */
  handFor(lookup: FlopLookup, player: 0 | 1, cards: string[]): number {
    return mapHand(parseCards(cards.join('')), lookup.mapper, lookup.data.hands[player], lookup.data.handIndexes[player]);
  }
}

/** Reach weight of each hand at a node; older files without weights count every hand once. */
export const nodeWeights = (node: FlopNode, hands: number) => node.weights ?? new Array<number>(hands).fill(1);

/** Weighted share of the whole range taking each action at a node (0-1). */
export function flopRangeSummary(data: LoadedFlop, node: FlopNode): number[] {
  const w = nodeWeights(node, data.hands[node.player].length);
  const total = w.reduce((a, b) => a + b, 0) || 1;
  return node.strategy.map((row) => row.reduce((s, f, h) => s + (f / 1000) * w[h], 0) / total);
}

/** Per hand class (e.g. "AKs"), the weighted average strategy at a node; classes not in the range are left out. */
export function flopClassStrategy(data: LoadedFlop, node: FlopNode): Record<string, number[]> {
  const hands = data.hands[node.player];
  const w = nodeWeights(node, hands.length);
  const sums = new Map<string, { w: number; f: number[] }>();
  hands.forEach((h, i) => {
    if (w[i] <= 0) return;
    const hc = handClass(h.slice(0, 2), h.slice(2));
    const s = sums.get(hc) ?? { w: 0, f: node.strategy.map(() => 0) };
    s.w += w[i];
    node.strategy.forEach((row, a) => (s.f[a] += (row[i] / 1000) * w[i]));
    sums.set(hc, s);
  });
  return Object.fromEntries([...sums].map(([hc, s]) => [hc, s.f.map((x) => Math.round((x / s.w) * 1000) / 1000)]));
}
