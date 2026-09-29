import type { HandView } from '@gtotutor/shared-types';
import { useEffect, useRef } from 'react';
import type { PlaybackState } from '../playback';
import { condensedCuesFor } from './cues';
import { playSound } from './soundEngine';

export function useTableSounds(hand: HandView, playback: PlaybackState, animate: boolean): void {
  const prev = useRef<PlaybackState | null>(null);
  useEffect(() => {
    for (const cue of condensedCuesFor(prev.current, playback, hand, animate)) playSound(cue.sound, cue.delayMs);
    prev.current = playback;
  }, [hand, playback, animate]);
}
