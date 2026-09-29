import type { HandView } from '@gtotutor/shared-types';
import { initialPlayback, type PlaybackState } from '../playback';
import type { SoundName } from './soundEngine';

export interface Cue {
  sound: SoundName;
  delayMs: number;
}

/** Deal-card sound spacing; matches the per-card `--deal-delay` in Table.tsx. */
export const DEAL_SPACING_MS = 45;

/** Which sounds to play when playback advances from `prev` to `next`. */
export function cuesFor(prev: PlaybackState | null, next: PlaybackState, hand: HandView): Cue[] {
  const cues: Cue[] = [];
  if (!prev || prev.handId !== next.handId) {
    const cards = hand.seats.length * 2;
    for (let i = 0; i < cards; i++) cues.push({ sound: 'deal', delayMs: i * DEAL_SPACING_MS });
    return cues;
  }

  for (const a of hand.actionLog.slice(prev.steps, next.steps)) {
    cues.push({ sound: a.action === 'fold' ? 'muck' : a.action === 'check' ? 'check' : a.action === 'allin' ? 'allin' : 'chip', delayMs: 0 });
  }
  if (!prev.gathered && next.gathered && hand.actionLog.some((a) => a.action !== 'fold')) cues.push({ sound: 'sweep', delayMs: 0 });
  for (let i = 0; i < next.board - prev.board; i++) cues.push({ sound: 'deal', delayMs: i * 90 });
  if (!prev.showdown && next.showdown) cues.push({ sound: 'deal', delayMs: 0 }, { sound: 'deal', delayMs: 60 });
  if (!prev.awarded && next.awarded) cues.push({ sound: 'sweep', delayMs: 0 });
  return cues;
}

/** With animations off, playback jumps straight to the end: play each kind of sound once, lightly staggered. */
export function condensedCuesFor(prev: PlaybackState | null, next: PlaybackState, hand: HandView, animate: boolean): Cue[] {
  if (animate) return cuesFor(prev, next, hand);
  const sameHand = prev !== null && prev.handId === next.handId;
  const all = sameHand ? cuesFor(prev, next, hand) : [...cuesFor(null, next, hand), ...cuesFor(initialPlayback(next.handId), next, hand)];
  const seen = new Set<string>();
  return all.filter((c) => !seen.has(c.sound) && seen.add(c.sound)).map((c, i) => ({ sound: c.sound, delayMs: i * 70 }));
}
