import type { ActionType } from '@gtotutor/shared-types';

export const ACTION_COLORS: Record<ActionType, string> = {
  fold: '#4a5b6e',
  call: '#2f9e62',
  raise: '#e0873a',
  allin: '#c93c3c',
};

/** Order stripes aggressive-first so ranges read left-to-right like standard charts. */
export const STRIPE_ORDER: ActionType[] = ['allin', 'raise', 'call', 'fold'];
