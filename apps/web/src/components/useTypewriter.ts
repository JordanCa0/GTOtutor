import { useCallback, useEffect, useRef, useState } from 'react';

/** At least this many characters a second; longer text speeds up so it never takes more than MAX_SECONDS. */
const MIN_CPS = 90;
const MAX_SECONDS = 3;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * Reveals `texts` one character at a time, one after another, like the coach typing. Returns the
 * visible part of each, whether it has finished, and `finish` to show everything at once (a click).
 * With reduced motion, or `instant`, everything shows straight away.
 */
export function useTypewriter(texts: string[], instant = false): { shown: string[]; done: boolean; finish: () => void } {
  const key = texts.join('\u0000');
  const total = texts.reduce((s, t) => s + t.length, 0);
  const skip = instant || reducedMotion();
  const [count, setCount] = useState(skip ? Infinity : 0);
  const finished = useRef(skip);

  useEffect(() => {
    finished.current = skip;
    if (skip) {
      setCount(Infinity);
      return;
    }
    setCount(0);
    const cps = Math.max(MIN_CPS, total / MAX_SECONDS);
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      if (finished.current) return;
      const n = Math.floor(((now - start) / 1000) * cps);
      setCount(n);
      if (n < total) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, skip, total]);

  const finish = useCallback(() => {
    finished.current = true;
    setCount(Infinity);
  }, []);

  let left = count;
  const shown = texts.map((t) => {
    const part = t.slice(0, Math.max(0, left));
    left -= t.length;
    return part;
  });
  return { shown, done: count >= total, finish };
}
