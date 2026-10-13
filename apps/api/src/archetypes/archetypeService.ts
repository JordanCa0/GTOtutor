import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Archetype, LegalAction } from '@gtotutor/shared-types';
import type { ChartNode } from '../charts/types.js';
import { ALL_HAND_CLASSES } from '../poker/cards.js';
import { ARCHETYPE_DEFS, ARCHETYPE_DEFS_VERSION, bucketOf, combos, ruleFrequencies } from './archetypes.js';
import type { JevChoice, JevClient } from './jevClient.js';

/** Share of an archetype's preflop strategy taken from JEV AI; the rest is the rule baseline, which steadies odd answers. */
export const JEV_WEIGHT = 0.8;
/** Hand classes per Jev request when building charts (13 requests cover a node's 169). */
const CHUNK = 13;
/** Jev requests in flight at once while building charts. */
const MAX_IN_FLIGHT = 3;
/** How long a postflop decision waits for JEV AI before the opponent plays the solver strategy instead. */
const POSTFLOP_TIMEOUT_MS = 6000;

/** One postflop decision for JEV AI: what it sees, and its options (in the node's action order). */
export interface PostflopQuestion {
  state: Record<string, unknown>;
  instructions: string;
  /** Option name -> description, in the order of the node's actions. */
  options: [string, string][];
}

const ACTION_TEXT: Record<string, string> = {
  fold: 'Fold: give up the hand.',
  check: 'Check: see the flop for free.',
  call: 'Call (or limp when nobody has raised): put in the minimum to continue.',
  raise: 'Raise: put in more to take the lead.',
  allin: 'Go all-in.',
};

/** An archetype chart file (preflop/charts/archetypes/<charts version>.json). */
interface ArchetypeChartFile {
  /** "<charts version>|<ARCHETYPE_DEFS_VERSION>": a file built for other charts or definitions is ignored. */
  version: string;
  /** "archetype|nodeKey" -> hand class -> Jev's frequencies, aligned with the node's actions. */
  nodes: Record<string, Record<string, number[]>>;
}

export interface ArchetypeServiceOptions {
  /** The premade archetype charts (built by apps/api/scripts/buildArchetypeCharts.ts); omit for rules only. */
  chartsFile?: string;
  /** The preflop charts' version: archetype charts built from other charts are ignored. */
  chartsVersion?: string;
  log?: (msg: string) => void;
}

/**
 * How archetype opponents play (docs/archetypes.md).
 *
 * Preflop is a lookup with no network calls: the premade archetype charts JEV AI answered once
 * (blended with the rules), or the rules alone for spots the charts don't cover. After the flop,
 * each decision is a live JEV AI call (`postflopChoice`).
 */
export class ArchetypeService {
  private readonly answers = new Map<string, Map<string, number[]>>();
  /** Jev's answers rescaled to each node's width (`calibrated`), by "archetype|nodeKey". */
  private readonly calibration = new Map<string, Map<string, number[]>>();
  private readonly queue: (() => Promise<void>)[] = [];
  private inFlight = 0;
  private readonly version: string;
  private readonly log: (msg: string) => void;

  constructor(
    private readonly jev: JevClient | null = null,
    private readonly opts: ArchetypeServiceOptions = {},
  ) {
    this.version = `${opts.chartsVersion ?? 'charts'}|${ARCHETYPE_DEFS_VERSION}`;
    this.log = opts.log ?? (() => {});
    this.load();
  }

  get jevEnabled(): boolean {
    return this.jev !== null;
  }

  /** Spots (archetype and chart node) the premade charts cover. */
  get chartedNodes(): number {
    return this.answers.size;
  }

  /**
   * The archetype's frequencies for a hand at a chart node, aligned with `node.actions`. For a
   * "|nocall" node the charts derive from `base`, Jev's answers for `base` are used the same way:
   * the call becomes a fold (the build doesn't ask Jev about those nodes separately).
   */
  frequencies(archetype: Archetype, node: ChartNode, handClass: string, base?: ChartNode): number[] {
    const rules = ruleFrequencies(archetype, node, handClass);
    const jev = this.calibrated(archetype, node, base)?.get(handClass);
    return jev ? rules.map((r, i) => JEV_WEIGHT * (jev[i] ?? 0) + (1 - JEV_WEIGHT) * r) : rules;
  }

  /**
   * Jev's answers for a node, rescaled to the rules' width (memoized per node; null when Jev has
   * no answers here). Jev judges which hands a player type plays and how, but not reliably how
   * many: asked alone, its fish plays ~85% of hands from every seat. So code sets the width, the
   * share of combos the rules play at this node (tuned per type from the chart), and the hands are
   * shifted in log-odds until they play that share. A hand's place in the order is Jev's play
   * log-odds plus the rules', each capped at 1-99%: Jev's clear preferences decide, and the rules
   * (chart and hand strength) order the many hands Jev is near-certain about alike, which would
   * otherwise be noise (a fish folding AKo). Jev's mix among the ways to play stays as answered.
   */
  private calibrated(archetype: Archetype, node: ChartNode, base?: ChartNode): Map<string, number[]> | null {
    const key = `${archetype}|${node.nodeKey}`;
    const memo = this.calibration.get(key);
    if (memo !== undefined) return memo;
    const own = this.answers.get(key);
    const raw = (hc: string) => own?.get(hc) ?? (own ? undefined : this.noCallAnswer(archetype, node, hc, base));
    if (!ALL_HAND_CLASSES.some((hc) => raw(hc))) {
      // Not memoized when nothing is known yet, so answers a build adds later are picked up.
      return null;
    }
    const out = new Map<string, number[]>();
    const isOut = node.actions.map((a) => bucketOf(a) === 'out');
    if (!isOut.some(Boolean) || isOut.every(Boolean)) {
      // Nothing to widen or narrow (no fold, or nothing but folds and checks): Jev's answers as given.
      for (const hc of ALL_HAND_CLASSES) {
        const r = raw(hc);
        if (r) out.set(hc, r);
      }
    } else {
      const play = (f: number[]) => f.reduce((s, x, i) => s + (isOut[i] ? 0 : x), 0);
      // Hands Jev missed (a failed request) take the rules' play share, so they keep their place.
      const answers = ALL_HAND_CLASSES.map((hc) => ({ hc, f: raw(hc) ?? ruleFrequencies(archetype, node, hc), w: combos(hc) }));
      const totalW = answers.reduce((s, a) => s + a.w, 0);
      const target = ALL_HAND_CLASSES.reduce((s, hc) => s + combos(hc) * play(ruleFrequencies(archetype, node, hc)), 0) / totalW;
      const logits = answers.map((a) => logit(play(a.f), ORDER_CAP) + logit(play(ruleFrequencies(archetype, node, a.hc)), ORDER_CAP));
      const width = (shift: number) => answers.reduce((s, a, i) => s + a.w * sigmoid(logits[i] + shift), 0) / totalW;
      let lo = -40;
      let hi = 40;
      for (let i = 0; i < 60; i++) {
        const mid = (lo + hi) / 2;
        if (width(mid) < target) lo = mid;
        else hi = mid;
      }
      const shift = (lo + hi) / 2;
      answers.forEach((a, i) => {
        if (!raw(a.hc)) return;
        const p = sigmoid(logits[i] + shift);
        out.set(a.hc, rescale(a.f, isOut, p));
      });
    }
    this.calibration.set(key, out);
    return out;
  }

  /** Jev's answer for `base`, with the call folded, aligned with the "|nocall" `node`'s actions. */
  private noCallAnswer(archetype: Archetype, node: ChartNode, handClass: string, base?: ChartNode): number[] | undefined {
    const answer = base && this.answers.get(`${archetype}|${base.nodeKey}`)?.get(handClass);
    if (!answer) return undefined;
    const call = base.actions.findIndex((a) => a.id === 'call');
    const out = node.actions.map((a) => {
      const i = base.actions.findIndex((b) => b.id === a.id && b.toBb === a.toBb);
      return i < 0 ? 0 : answer[i] + (a.id === 'fold' && call >= 0 ? answer[call] : 0);
    });
    return out.some((f) => f > 0) ? out : undefined;
  }

  /**
   * JEV AI's frequencies for one postflop decision, aligned with `q.options`; null without a key, or
   * when Jev fails or is too slow (the caller falls back to the solver).
   */
  async postflopChoice(q: PostflopQuestion): Promise<number[] | null> {
    if (!this.jev) return null;
    try {
      const answer = await this.jev.choose(q.state, { action: { instructions: q.instructions, criteria: Object.fromEntries(q.options) } }, POSTFLOP_TIMEOUT_MS);
      const probs = answer.action;
      if (!probs) return null;
      const freqs = q.options.map(([name]) => Math.max(0, probs[name] ?? 0));
      const total = freqs.reduce((a, b) => a + b, 0);
      return total > 0 ? freqs.map((f) => f / total) : null;
    } catch (err) {
      this.log(`JEV AI postflop decision failed: ${(err as Error).message}`);
      return null;
    }
  }

  // Building the charts (apps/api/scripts/buildArchetypeCharts.ts), never during play.

  /** Queues Jev requests for the hand classes this node is still missing; returns how many requests. */
  build(archetype: Archetype, node: ChartNode): number {
    if (!this.jev) throw new Error('Building archetype charts needs JEV_API_KEY.');
    const key = `${archetype}|${node.nodeKey}`;
    const known = this.answers.get(key);
    const missing = ALL_HAND_CLASSES.filter((hc) => !known?.has(hc));
    let requests = 0;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const chunk = missing.slice(i, i + CHUNK);
      requests++;
      this.enqueue(() => this.ask(key, archetype, node, chunk).catch((err: unknown) => this.log(`JEV AI request for ${key} failed: ${(err as Error).message}`)));
    }
    return requests;
  }

  /** Resolves once every queued and running Jev request has finished. */
  async idle(): Promise<void> {
    while (this.inFlight > 0 || this.queue.length > 0) await new Promise((r) => setTimeout(r, 20));
  }

  /** Writes the charts file (the build script calls it as it goes, so a stopped build resumes). */
  save(): void {
    const file = this.opts.chartsFile;
    if (!file) return;
    const out: ArchetypeChartFile = { version: this.version, nodes: {} };
    for (const [key, hands] of [...this.answers].sort(([a], [b]) => a.localeCompare(b))) {
      out.nodes[key] = Object.fromEntries([...hands].map(([hc, f]) => [hc, f.map((x) => Math.round(x * 1000) / 1000)]));
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(out));
  }

  private async ask(key: string, archetype: Archetype, node: ChartNode, hands: string[]): Promise<void> {
    const names = optionNames(node.actions);
    const criteria = Object.fromEntries(node.actions.map((a, i) => [names[i], `${a.label}. ${ACTION_TEXT[a.id] ?? ''}`.trim()]));
    const questions: Record<string, JevChoice> = {};
    for (const hc of hands) {
      const chart = node.strategy.get(hc);
      const mix = chart ? node.actions.map((a, i) => `${a.label} ${Math.round(chart[i] * 100)}%`).join(', ') : 'unknown';
      questions[hc] = {
        instructions: `I hold ${hc}. A balanced (GTO) player here would play it: ${mix}. Playing as the player described in the state, which action do I take?`,
        criteria,
      };
    }
    const state = {
      game: "6-max no-limit Texas hold'em cash game, preflop",
      spot: node.label,
      player: ARCHETYPE_DEFS[archetype].description,
      task: 'Choose what this player type would really do with each hand, including their typical mistakes. Answer as them, not as a balanced player, unless they would play it the same way.',
    };
    const result = await this.jev!.choose(state, questions);
    let map = this.answers.get(key);
    if (!map) this.answers.set(key, (map = new Map()));
    this.calibration.clear();
    for (const hc of hands) {
      const probs = result[hc];
      if (!probs) continue;
      const freqs = names.map((n) => Math.max(0, probs[n] ?? 0));
      const total = freqs.reduce((a, b) => a + b, 0);
      if (total > 0) map.set(hc, freqs.map((f) => f / total));
    }
  }

  private enqueue(job: () => Promise<void>): void {
    this.queue.push(job);
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length) {
      const job = this.queue.shift()!;
      this.inFlight++;
      void job().finally(() => {
        this.inFlight--;
        this.pump();
      });
    }
  }

  private load(): void {
    const path = this.opts.chartsFile;
    if (!path) return;
    let file: ArchetypeChartFile;
    try {
      file = JSON.parse(readFileSync(path, 'utf8')) as ArchetypeChartFile;
    } catch {
      return; // Not built yet: rules only.
    }
    if (file.version !== this.version) {
      this.log(`archetype charts ${path} were built for ${file.version}, not ${this.version}: using the rules instead`);
      return;
    }
    for (const [key, hands] of Object.entries(file.nodes)) this.answers.set(key, new Map(Object.entries(hands)));
  }
}

/** Unique option names for a node's actions: the action id, plus the size when one id appears twice. */
export function optionNames(actions: LegalAction[]): string[] {
  return actions.map((a) => (actions.filter((b) => b.id === a.id).length > 1 ? `${a.id}_${a.toBb}` : a.id));
}

/** How far from 0 or 1 a probability is capped before ordering hands by it (`calibrated`). */
const ORDER_CAP = 0.01;

const logit = (p: number, cap = 1e-4) => {
  const q = Math.min(1 - cap, Math.max(cap, p));
  return Math.log(q / (1 - q));
};
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** `f` with its playing actions scaled to total `play` and its fold/check to the rest, each in `f`'s proportions. */
function rescale(f: number[], isOut: boolean[], play: number): number[] {
  const sum = (out: boolean) => f.reduce((s, x, i) => s + (isOut[i] === out ? x : 0), 0);
  const share = (out: boolean, mass: number) => {
    const total = sum(out);
    const idx = f.map((_, i) => i).filter((i) => isOut[i] === out);
    return (i: number) => (total > 0 ? (mass * f[i]) / total : i === idx[0] ? mass : 0);
  };
  const playShare = share(false, play);
  const outShare = share(true, 1 - play);
  return f.map((_, i) => (isOut[i] ? outShare(i) : playShare(i)));
}
