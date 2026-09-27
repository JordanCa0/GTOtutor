import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import type { ActionLogEntry, DataSource, DecisionFeedback, ExplanationResponse } from '@gtotutor/shared-types';
import { z } from 'zod';
import { findUngroundedPercentages } from './grounding.js';
import { HourlyRateLimiter } from './rateLimit.js';

const PROMPT_VERSION = 'v1';

export interface ExplainInput {
  decision: DecisionFeedback;
  actionsBefore: ActionLogEntry[];
  heroPosition: string;
  stackDepthBb: number;
  rangeSummary: { label: string; share: number }[];
  dataSource: DataSource;
}

export interface GeneratedExplanation {
  explanationText: string;
  keyFactors: string[];
}

export type ExplanationGenerator = (system: string, context: string) => Promise<GeneratedExplanation>;

export class ExplanationUnavailable extends Error {}

const SYSTEM_PROMPT = `You are the coach inside GTOtutor, a No-Limit Hold'em cash-game trainer. A student just made a preflop decision. You receive the strategy chart's numbers for that exact spot; treat them as ground truth and explain them — never recompute or second-guess them.

Explain why the chart plays this hand this way: hand strength relative to the ranges involved, position, blockers, playability, the opponent's likely range, and stack depth. Say plainly whether the student's choice matched the chart, and if the spot is a mixed strategy, explain why mixing is correct.

Only cite percentages that appear in the provided data. Do not invent EVs, win rates, or frequencies. If the data source is described as placeholder ranges, do not call it solver output.

Write 2-3 short paragraphs of plain language for an intermediate player, no headings or markdown. keyFactors: 2-4 short phrases naming the main reasons.`;

const ExplanationSchema = z.object({
  explanationText: z.string(),
  keyFactors: z.array(z.string()),
});

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;

export function buildContext(input: ExplainInput): string {
  const { decision: d } = input;
  const before = input.actionsBefore.length
    ? input.actionsBefore.map((a) => `${a.position} ${a.action === 'fold' ? 'folds' : a.action === 'call' ? `calls ${a.toBb}` : `raises to ${a.toBb}`}`).join(', ')
    : 'Nobody has acted yet (blinds posted: SB 0.5, BB 1).';
  const chosen = d.options.find((o) => o.actionId === d.chosenAction)!;
  return [
    `Game: 6-max cash, ${input.stackDepthBb}bb effective stacks. Hero is ${input.heroPosition}.`,
    `Action before hero: ${before}`,
    `Spot: ${d.nodeLabel}`,
    `Hero hand: ${d.heroCards.join(' ')} (class ${d.handClass})`,
    `Chart strategy for ${d.handClass} here: ${d.options.map((o) => `${o.label} ${pct(o.frequency)}`).join(', ')}. EV: ${d.options.some((o) => o.evBb !== null) ? d.options.map((o) => `${o.label} ${o.evBb ?? 'n/a'}bb`).join(', ') : 'not available'}.`,
    `Whole range at this spot (all hands): ${input.rangeSummary.map((r) => `${r.label} ${pct(r.share)}`).join(', ')}.`,
    `Hero chose: ${chosen.label} (chart frequency ${pct(d.chosenFrequency)}). Grade: ${d.grade === 'best' ? 'highest-frequency action' : d.grade === 'mixed' ? 'part of a mixed strategy, not the main action' : 'rarely or never taken by the chart'}.`,
    `Data source: ${input.dataSource.note}`,
  ].join('\n');
}

export function claudeGenerator(model: string): ExplanationGenerator {
  let client: Anthropic | null = null;
  return async (system, context) => {
    try {
      client ??= new Anthropic();
      const response = await client.beta.messages.parse({
        model,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system,
        messages: [{ role: 'user', content: context }],
        output_config: { effort: 'medium', format: betaZodOutputFormat(ExplanationSchema) },
      });
      if (response.stop_reason === 'refusal') throw new ExplanationUnavailable('The coach declined to answer this one.');
      if (!response.parsed_output) throw new ExplanationUnavailable('The coach returned an unreadable answer — try again.');
      return response.parsed_output;
    } catch (err) {
      if (err instanceof ExplanationUnavailable) throw err;
      if (err instanceof Anthropic.AuthenticationError) throw new ExplanationUnavailable('Claude API key is missing or invalid (set ANTHROPIC_API_KEY in apps/api/.env).');
      if (err instanceof Anthropic.RateLimitError) throw new ExplanationUnavailable('Claude API is rate-limiting requests — try again shortly.');
      if (err instanceof Anthropic.APIConnectionError) throw new ExplanationUnavailable('Could not reach the Claude API.');
      if (err instanceof Anthropic.APIError) throw new ExplanationUnavailable(`Claude API error (${err.status ?? 'unknown'}).`);
      // The client constructor throws a plain Error when no credentials are configured.
      if (err instanceof Error && /api.?key|auth/i.test(err.message)) throw new ExplanationUnavailable('Claude API key is not configured (set ANTHROPIC_API_KEY in apps/api/.env).');
      throw err;
    }
  };
}

export class LlmTeacher {
  private readonly cache = new Map<string, GeneratedExplanation & { ungroundedNumbers: string[] }>();
  private readonly limiter: HourlyRateLimiter;

  constructor(
    private readonly generate: ExplanationGenerator,
    private readonly cacheNamespace: string,
    missLimitPerHour: number,
  ) {
    this.limiter = new HourlyRateLimiter(missLimitPerHour);
  }

  async explain(input: ExplainInput, clientKey: string): Promise<ExplanationResponse> {
    const d = input.decision;
    const cacheKey = [d.nodeKey, d.handClass, d.chosenAction, PROMPT_VERSION, this.cacheNamespace].join('#');
    const hit = this.cache.get(cacheKey);
    if (hit) return { status: 'ok', ...hit, cached: true };

    if (!this.limiter.tryConsume(clientKey)) {
      return { status: 'unavailable', reason: 'Hourly limit for new AI explanations reached — try again later.' };
    }

    let generated: GeneratedExplanation;
    try {
      generated = await this.generate(SYSTEM_PROMPT, buildContext(input));
    } catch (err) {
      if (err instanceof ExplanationUnavailable) return { status: 'unavailable', reason: err.message };
      throw err;
    }

    const allowed = [...d.options.map((o) => o.frequency * 100), ...input.rangeSummary.map((r) => r.share * 100)];
    const ungroundedNumbers = findUngroundedPercentages(generated.explanationText, allowed);
    const entry = { ...generated, keyFactors: generated.keyFactors.slice(0, 4), ungroundedNumbers };
    // Only cache explanations that pass the grounding check, so a bad one gets regenerated next time.
    if (ungroundedNumbers.length === 0) this.cache.set(cacheKey, entry);
    return { status: 'ok', ...entry, cached: false };
  }
}
