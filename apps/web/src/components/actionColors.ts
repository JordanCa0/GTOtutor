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
