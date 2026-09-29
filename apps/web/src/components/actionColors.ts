import type { ActionType } from '@gtotutor/shared-types';

export const ACTION_COLORS: Record<ActionType, string> = {
  fold: '#3a4452',
  call: '#2e9a68',
  raise: '#d2a24c',
  allin: '#b8393b',
};

/** Order stripes aggressive-first so ranges read left-to-right like standard charts. */
export const STRIPE_ORDER: ActionType[] = ['allin', 'raise', 'call', 'fold'];
