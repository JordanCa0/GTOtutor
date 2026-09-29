import { useSyncExternalStore } from 'react';
import { isSoundEnabled, setSoundEnabled } from './sound/soundEngine';

export interface Settings {
  sound: boolean;
  animations: boolean;
}

const ANIMATIONS_KEY = 'gtotutor.animations';

function readAnimations(): boolean {
  try {
    return localStorage.getItem(ANIMATIONS_KEY) !== 'off';
  } catch {
    return true;
  }
}

let current: Settings = { sound: isSoundEnabled(), animations: readAnimations() };
const listeners = new Set<() => void>();

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch };
  if (patch.sound !== undefined) setSoundEnabled(patch.sound);
  if (patch.animations !== undefined) {
    try {
      localStorage.setItem(ANIMATIONS_KEY, patch.animations ? 'on' : 'off');
    } catch {
      // storage blocked; the setting lasts for this tab only
    }
  }
  listeners.forEach((l) => l());
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}
