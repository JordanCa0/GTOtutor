import type { ActionType } from '@gtotutor/shared-types';

export const ACTION_COLORS: Record<ActionType, string> = {
  fold: '#3a4452',
  check: '#d2a24c',
  call: '#d2a24c',
  raise: '#2e9a68',
  allin: '#1f7a4f',
};

/** Order stripes aggressive-first so ranges read left-to-right like standard charts. */
export const STRIPE_ORDER: ActionType[] = ['allin', 'raise', 'call', 'check', 'fold'];
