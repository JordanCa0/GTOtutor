import type { HandView } from '@gtotutor/shared-types';
import { useEffect, useMemo, useState } from 'react';
import { finalPlayback, initialPlayback, nextPlayback, type PlaybackState } from './playback';

const reducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

export function usePlayback(hand: HandView, animate: boolean) {
  const [stored, setStored] = useState<PlaybackState>(() => initialPlayback(hand.id));
  const final = useMemo(() => finalPlayback(hand), [hand]);
  const playback = !animate ? final : stored.handId === hand.id ? stored : initialPlayback(hand.id);

  useEffect(() => {
    // Keep the stored state caught up so turning animations back on doesn't replay old steps.
    if (!animate) {
      setStored(final);
      return;
    }
    const next = nextPlayback(playback, hand);
    if (!next) return;
    const timer = setTimeout(() => setStored(next.state), reducedMotion() ? 0 : next.delay);
    return () => clearTimeout(timer);
  }, [playback, hand, animate, final]);

  return {
    playback,
    done: nextPlayback(playback, hand) === null,
    skip: () => setStored(final),
  };
}
