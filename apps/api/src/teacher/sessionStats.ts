import { bestOption, chosenOption, type DecisionFeedback, type LeakType, type SessionStats, type SpotType } from '@gtotutor/shared-types';

const SPOT_LABELS: Record<SpotType, string> = {
  RFI: 'Opening (first in)',
  LIMPED: 'Limped pots (SB vs BB)',
  VS_OPEN: 'Facing an open',
  VS_3BET: 'Facing a 3-bet',
  VS_4BET_PLUS: 'Facing a 4-bet or all-in',
  FLOP: 'Flop decisions',
};

const LEAK_LABELS: Record<LeakType, string> = {
  over_fold: 'Folding hands the chart plays',
  over_call: 'Calling hands the chart folds',
  over_raise: 'Betting or raising where the chart folds, checks or calls',
  under_raise: 'Calling or checking where the chart bets or raises',
};

export function spotTypeOf(nodeKey: string): SpotType {
  if (nodeKey.startsWith('FLOP|')) return 'FLOP';
  const type = nodeKey.split('|')[2];
  if (type === 'RFI') return 'RFI';
  if (type === 'VS_LIMP' || type === 'VS_ISO') return 'LIMPED';
  if (type === 'VS_OPEN') return 'VS_OPEN';
  if (type === 'VS_3BET' || type === 'COLD_VS_3BET') return 'VS_3BET';
  return 'VS_4BET_PLUS';
}

export function leakTypeOf(d: DecisionFeedback): LeakType | null {
  if (d.grade !== 'mistake') return null;
  const aggressive = (a: string) => a === 'bet' || a === 'raise' || a === 'allin';
  if (d.chosenAction === 'fold') return 'over_fold';
  if (d.chosenAction === 'call') return aggressive(d.bestAction) ? 'under_raise' : 'over_call';
  if (d.chosenAction === 'check') return aggressive(d.bestAction) ? 'under_raise' : null;
  return 'over_raise';
}

export function computeSessionStats(hands: { decisions: DecisionFeedback[] }[], easyFoldsSkipped: boolean): SessionStats {
  const decisions = hands.flatMap((h) => h.decisions);
  const grades = { best: 0, mixed: 0, mistake: 0 };
  const spots = new Map<SpotType, { decisions: number; best: number; mistakes: number }>();
  const leaks = new Map<LeakType, number>();

  for (const d of decisions) {
    grades[d.grade]++;
    const spot = spotTypeOf(d.nodeKey);
    const s = spots.get(spot) ?? { decisions: 0, best: 0, mistakes: 0 };
    s.decisions++;
    if (d.grade === 'best') s.best++;
    if (d.grade === 'mistake') s.mistakes++;
    spots.set(spot, s);
    const leak = leakTypeOf(d);
    if (leak) leaks.set(leak, (leaks.get(leak) ?? 0) + 1);
  }

  const worstMistakes = decisions
    .filter((d) => d.grade === 'mistake')
    .sort((a, b) => a.chosenFrequency - b.chosenFrequency || bestOption(b).frequency - bestOption(a).frequency)
    .slice(0, 5)
    .map((d) => ({
      nodeLabel: d.nodeLabel,
      heroCards: d.heroCards,
      handClass: d.handClass,
      chosenLabel: chosenOption(d).label,
      chosenFrequency: d.chosenFrequency,
      bestLabel: bestOption(d).label,
      bestFrequency: bestOption(d).frequency,
    }));

  return {
    hands: hands.filter((h) => h.decisions.length > 0).length,
    decisions: decisions.length,
    grades,
    hintsUsed: decisions.filter((d) => d.hintUsed).length,
    bySpot: (Object.keys(SPOT_LABELS) as SpotType[])
      .filter((spot) => spots.has(spot))
      .map((spot) => ({ spot, label: SPOT_LABELS[spot], ...spots.get(spot)! })),
    leaks: [...leaks.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({ type, label: LEAK_LABELS[type], count })),
    worstMistakes,
    easyFoldsSkipped,
  };
}
