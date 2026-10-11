import type { DecisionFeedback } from '@gtotutor/shared-types';
import { describe, expect, it } from 'vitest';
import { ChartService } from '../src/charts/chartService.js';
import { buildFixtureChartSet } from '../src/charts/fixtures.js';
import { HandEngine } from '../src/engine/handEngine.js';
import { runoutResolver } from '../src/engine/showdownResolver.js';
import { FlopStore } from '../src/postflop/flopStore.js';
import { lineReach, preflopRanges, turnStart } from '../src/postflop/liveSolve.js';
import { seededRng } from '../src/poker/rng.js';
import { findUngroundedPercentages } from '../src/teacher/grounding.js';
import { postflopGroup, preflopGroup } from '../src/teacher/handGroups.js';
import { LlmTeacher, buildContext, type CoachTool, type ExplainInput } from '../src/teacher/llmTeacher.js';
import { lookupHand, summarizeSpot } from '../src/teacher/spotSummary.js';
import { fakeLlm, fakeSolverOutput } from './fakes.js';

const charts = new ChartService(buildFixtureChartSet());
const flops = new FlopStore(fakeSolverOutput());
const engine = new HandEngine(charts, seededRng(1), runoutResolver, flops);

describe('hand groups', () => {
  it('groups starting hands', () => {
    expect(['AA', '77', '33', 'A5s', 'KQs', '87s', 'K4s', 'AKo', 'A9o', '72o'].map(preflopGroup)).toEqual([
      'High pairs (TT+)',
      'Middle pairs (66-99)',
      'Low pairs (22-55)',
      'Suited aces',
      'Suited broadways',
      'Suited connectors and gappers',
      'Other suited',
      'Offsuit broadways',
      'Offsuit aces',
      'Other offsuit',
    ]);
  });

  it('groups made hands and draws on a board', () => {
    const board = ['Kh', '7d', '2c'];
    const g = (a: string, b: string, on = board) => postflopGroup([a, b], on);
    expect(g('7s', '7c').group).toBe('Sets and trips');
    expect(g('As', 'Ac').group).toBe('Overpairs');
    expect(g('Ks', 'Qd').group).toBe('Top pair, good kicker');
    expect(g('Ks', '9d').group).toBe('Top pair, weak kicker');
    expect(g('8s', '7c').group).toBe('Middle pair');
    expect(g('5s', '5c').group).toBe('Underpairs');
    expect(g('As', 'Qd').group).toBe('Air');
    expect(g('Ah', 'Qh', ['Kh', '7h', '2c']).group).toBe('Flush draws');
    expect(g('6s', '5d', ['8h', '7d', '2c']).group).toBe('Open-ended straight draws');
    expect(g('9s', '5d', ['8h', '7d', '2c']).group).toBe('Gutshots');
    expect(g('6s', '5d', ['8h', '7d', '4c']).group).toBe('Straight or better');
    // A made hand keeps its group and notes the draw; no draws on the river.
    expect(g('Kh', 'Qh', ['Kd', '7h', '2h'])).toEqual({ group: 'Top pair, good kicker', draw: 'flush draw' });
    expect(g('Ah', 'Qh', ['Kh', '7h', '2c', '3s', '9d']).group).toBe('Air');
  });
});

describe('both ranges at a decision', () => {
  const data = flops.load('btn_vs_bb_srp_100', 'Kh7d2c');
  const spot = flops.spotInfo('btn_vs_bb_srp_100')!;

  it('reaches the same ranges as the turn start', () => {
    expect(lineReach(data.byHistory, preflopRanges(data, spot), [0, 1, 1])).toEqual(turnStart(data, spot, [0, 1, 1])!.ranges);
  });

  it('gives hero the node strategy and villain the range along the line, on the solved flop', () => {
    // BTN facing a check: hero is IP, villain is BB, who checked everything.
    const r = engine.spotRanges('FLOP|btn_vs_bb_srp_100|Kh7d2c|0')!;
    expect(r).toMatchObject({ source: 'solver', board: ['Kh', '7d', '2c'], actions: ['Check', 'Bet 1.8'] });
    expect(r.villain!.position).toBe('BB');
    expect(r.villain!.weights.every((w) => w === 1)).toBe(true);
    expect(r.hero.strategy[0][0]).toBe(0.5);
  });

  it('describes the last raiser preflop, and has no villain without one', () => {
    const r = engine.spotRanges('SIX_MAX|100|VS_OPEN|BB|BTN', { position: 'BTN', nodeKey: 'SIX_MAX|100|RFI|BTN', actionId: 'raise' })!;
    expect(r.source).toBe('chart');
    expect(r.villain!.position).toBe('BTN');
    expect(r.hero.hands).toHaveLength(169);
    expect(engine.spotRanges('SIX_MAX|100|RFI|UTG')!.villain).toBeNull();
    expect(engine.spotRanges('LIVE|' + 'f'.repeat(32) + '|turn||')).toBeNull();
  });

  it('summarizes by group with only numbers it states, and looks hands up', () => {
    const r = engine.spotRanges('FLOP|btn_vs_bb_srp_100|Kh7d2c|0')!;
    const { text, percents } = summarizeSpot(r, { handClass: 'KQs', group: 'Top pair, good kicker' });
    expect(text).toContain('Top pair, good kicker');
    expect(text).toContain("BB's range at this point");
    expect(text).toContain('Hands near hero');
    expect(text.split('\n').length).toBeLessThanOrEqual(25);
    expect(findUngroundedPercentages(text, percents)).toEqual([]);

    const ak = lookupHand(r, 'aks', 'hero');
    expect(ak.text).toMatch(/^AKs for hero: .*Check 50%, Bet 1.8 50%/);
    expect(findUngroundedPercentages(ak.text, ak.percents)).toEqual([]);
    expect(lookupHand(r, 'AsKd', 'villain').text).toMatch(/^AsKd in BB's range/);
    expect(lookupHand(r, 'banana', 'hero').text).toMatch(/isn't a hand/);
  });
});

describe('the coach sees the whole spot', () => {
  const decision: DecisionFeedback = {
    id: 'h-d1',
    nodeKey: 'FLOP|btn_vs_bb_srp_100|Kh7d2c|0',
    nodeLabel: 'BTN facing a check',
    heroCards: ['Ks', 'Qs'],
    handClass: 'KQs',
    chosenAction: 'bet',
    options: [
      { actionId: 'check', label: 'Check', frequency: 0.5, evBb: null },
      { actionId: 'bet', label: 'Bet 1.8', toBb: 1.8, frequency: 0.5, evBb: null },
    ],
    chosenFrequency: 0.5,
    bestAction: 'check',
    grade: 'mixed',
    hintUsed: false,
    street: 'flop',
    board: ['Kh', '7d', '2c'],
    approxFlop: null,
  };
  const input: ExplainInput = {
    decision,
    nodeKey: decision.nodeKey,
    nodeLabel: decision.nodeLabel,
    heroCards: decision.heroCards,
    handClass: decision.handClass,
    options: decision.options,
    actionsBefore: [{ position: 'BB', action: 'check', toBb: 6, isHero: false, street: 'flop' }],
    priorDecisions: [],
    heroPosition: 'BTN',
    stackDepthBb: 100,
    rangeSummary: [
      { label: 'Check', share: 0.5 },
      { label: 'Bet 1.8', share: 0.5 },
    ],
    dataSource: { kind: 'solver', note: 'Solved.' },
    board: decision.board,
    approxFlop: null,
    spot: engine.spotRanges(decision.nodeKey),
  };

  it('puts the grouped ranges in the explanation context', () => {
    expect(buildContext(input)).toContain('<whole_spot>');
    expect(buildContext({ ...input, spot: null })).not.toContain('<whole_spot>');
  });

  it('lets follow-up chat look up a hand, and accepts the numbers it found', async () => {
    const llm = fakeLlm({
      structured: (_system: string, _messages: unknown, tools?: CoachTool[]) => {
        const found = tools![0].run({ hand: 'AKs', player: 'hero' });
        return { tldr: 'AKs mixes too.', detail: `The solver plays it like this: ${found}` };
      },
    });
    const teacher = new LlmTeacher(llm, 'test', 10);
    const res = await teacher.chat(input, [{ role: 'user', content: 'What about AKs?' }], 'ip');
    expect(res).toMatchObject({ status: 'ok', ungroundedNumbers: [] });
    if (res.status === 'ok') expect(res.reply).toContain('AKs for hero');
  });

  it('keeps hints free of the whole-spot data', async () => {
    const llm = fakeLlm({ text: 'Think about which hands want to bet.' });
    const teacher = new LlmTeacher(llm, 'test', 10);
    const { decision: _d, spot: _s, ...spotOnly } = input;
    await teacher.hint(spotOnly, 'ip');
    const [system, messages] = llm.text.mock.calls[0] as unknown as [string, { content: string }[]];
    expect(system + messages.map((m) => m.content).join('')).not.toContain('whole_spot');
  });
});
