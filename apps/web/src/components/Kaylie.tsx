import { useEffect, useMemo, useState, type CSSProperties } from 'react';

const WORD = 'kaylie';
const HEARTS_MS = 3600;

/**
 * For Kaylie: typing her name anywhere (outside a text box) turns the felt rose gold for the rest of the
 * hand, with a short fall of hearts. PlayArea remounts every hand, so it lasts one hand.
 * Once the "k" is in, the rest of the word is kept from the action shortcuts ("a" is all-in).
 */
export function useKaylie(): number | null {
  const [at, setAt] = useState<number | null>(null);
  useEffect(() => {
    let typed = 0;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || t.closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === WORD[typed]) {
        if (typed > 0) e.stopPropagation();
        typed++;
        if (typed === WORD.length) {
          typed = 0;
          setAt(Date.now());
        }
      } else typed = k === WORD[0] ? 1 : 0;
    };
    // Capture, so it runs before (and can hold back) the shortcut listener.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  return at;
}

const COLORS = ['#e8a0a8', '#f2c4c4', '#d4af6a', '#c9737f'];

/** About 3 seconds of hearts falling behind the seats; same rules as the chip shower (the caller checks the settings). */
export function HeartRain({ at }: { at: number }) {
  const [done, setDone] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDone(true), HEARTS_MS);
    return () => clearTimeout(t);
  }, [at]);

  const hearts = useMemo(() => {
    let seed = at % 2147483647 || 1;
    const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    return Array.from({ length: 22 }, () => ({
      left: `${rand() * 96}%`,
      color: COLORS[Math.floor(rand() * COLORS.length)],
      ['--size' as string]: `${16 + rand() * 14}px`,
      ['--drift' as string]: `${(rand() - 0.5) * 16}cqw`,
      ['--spin' as string]: `${(rand() - 0.5) * 120}deg`,
      animationDuration: `${1900 + rand() * 900}ms`,
      animationDelay: `${Math.round(rand() * 900)}ms`,
    }) as CSSProperties);
  }, [at]);

  if (done) return null;
  return (
    <div className="chip-rain heart-rain" aria-hidden>
      {hearts.map((style, i) => (
        <i key={i} style={style}>
          ♥
        </i>
      ))}
    </div>
  );
}
