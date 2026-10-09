import type { ActionType } from '@gtotutor/shared-types';

export const ACTION_COLORS: Record<ActionType, string> = {
  fold: '#3a4452',
  check: '#4a86c5',
  call: '#4a86c5',
  bet: '#3aa877',
  raise: '#2e9a68',
  allin: '#1f7a4f',
};

/** Order stripes aggressive-first so ranges read left-to-right like standard charts. */
export const STRIPE_ORDER: ActionType[] = ['allin', 'raise', 'bet', 'call', 'check', 'fold'];

type Sized = { id: ActionType; toBb?: number | null };

/**
 * Colour of option `i`: its type's colour, or, when several options share the type (flop bets of
 * 33/66/100%), a shade of it by size: smallest lighter, largest darker.
 */
export function optionColor(actions: Sized[], i: number): string {
  const same = actions.flatMap((a, j) => (a.id === actions[i].id ? [j] : [])).sort((p, q) => (actions[p].toBb ?? 0) - (actions[q].toBb ?? 0));
  const base = ACTION_COLORS[actions[i].id];
  if (same.length < 2) return base;
  const t = same.indexOf(i) / (same.length - 1) - 0.5; // -0.5 smallest .. 0.5 largest
  return t === 0 ? base : `color-mix(in oklab, ${base}, ${t < 0 ? 'white' : 'black'} ${Math.round(Math.abs(t) * 2 * 30)}%)`;
}

/** Option indexes in stripe order: by STRIPE_ORDER, and largest size first within a type. */
export function stripeOrder(actions: Sized[]): number[] {
  return actions
    .map((_, i) => i)
    .sort((p, q) => STRIPE_ORDER.indexOf(actions[p].id) - STRIPE_ORDER.indexOf(actions[q].id) || (actions[q].toBb ?? 0) - (actions[p].toBb ?? 0));
}
