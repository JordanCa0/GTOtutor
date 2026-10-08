import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export interface TourStep {
  /** CSS selector for the element to point at. Steps whose element isn't on screen are skipped. */
  target: string;
  title: string;
  body: string;
  /** Preferred side of the target for the card; it flips if there's no room. */
  side: 'top' | 'bottom' | 'left' | 'right';
}

const GAP = 14;
const GUTTER = 16;
const SPOT_PAD = 6;

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/**
 * First-run walkthrough: dims the page, outlines one element at a time and explains it in a small card.
 * Steps change instantly (they're driven by Next/Back and the arrow keys); only the first card fades in.
 */
export function Tour({ steps: all, onDone }: { steps: TourStep[]; onDone: () => void }) {
  // Fix the step list when the tour opens, so a step doesn't vanish mid-tour. Read after the commit, not
  // during render: the panels it points at may be mounting in the same render as the tour.
  const [steps, setSteps] = useState<TourStep[] | null>(null);
  useLayoutEffect(() => setSteps(all.filter((s) => document.querySelector(s.target))), [all]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [card, setCard] = useState<{ top: number; left: number } | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const count = steps?.length ?? 0;
  const step = steps?.[i];
  const last = i === count - 1;

  useEffect(() => {
    if (steps && !step) onDone();
  }, [steps, step, onDone]);

  // Bring the target into view (the side panel scrolls), then follow it every frame: it may still be animating in.
  useEffect(() => {
    if (!step) return;
    document.querySelector(step.target)?.scrollIntoView({ block: 'nearest' });
    let frame = 0;
    let prev = '';
    const track = () => {
      const el = document.querySelector(step.target);
      if (el) {
        const r = el.getBoundingClientRect();
        const next = { top: r.top, left: r.left, width: r.width, height: r.height };
        const key = Object.values(next).map(Math.round).join(',');
        if (key !== prev) {
          prev = key;
          setRect(next);
        }
      }
      frame = requestAnimationFrame(track);
    };
    track();
    return () => cancelAnimationFrame(frame);
  }, [step]);

  // Place the card next to the target once its size is known.
  useLayoutEffect(() => {
    if (!step || !rect || !cardRef.current) return;
    const { offsetWidth: w, offsetHeight: h } = cardRef.current;
    setCard(place(rect, w, h, step.side));
  }, [rect, step]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
      else if (e.key === 'ArrowRight') setI((n) => Math.min(n + 1, count - 1));
      else if (e.key === 'ArrowLeft') setI((n) => Math.max(n - 1, 0));
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onDone, count]);

  if (!step) return null;
  return createPortal(
    <div className="tour">
      {/* Blocks the page while the tour is open; the spotlight's huge shadow does the dimming. */}
      <div className="tour-catcher" />
      {rect && (
        <div
          className="tour-spot"
          style={{ top: rect.top - SPOT_PAD, left: rect.left - SPOT_PAD, width: rect.width + SPOT_PAD * 2, height: rect.height + SPOT_PAD * 2 }}
        />
      )}
      <div
        ref={cardRef}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        style={card ? { top: card.top, left: card.left } : { visibility: 'hidden' }}
      >
        <p className="tour-count">
          {i + 1} of {count}
        </p>
        <h2 id="tour-title">{step.title}</h2>
        <p className="tour-body">{step.body}</p>
        <div className="tour-actions">
          {!last && (
            <button className="link" onClick={onDone}>
              Skip tour
            </button>
          )}
          <span className="spacer" />
          {i > 0 && (
            <button className="ghost" onClick={() => setI(i - 1)}>
              Back
            </button>
          )}
          <button key={i} className="primary" onClick={() => (last ? onDone() : setI(i + 1))} autoFocus>
            {last ? 'Got it' : 'Next'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Puts the card on the preferred side of the target, flipping or clamping so it stays on screen. */
function place(r: Rect, w: number, h: number, side: TourStep['side']): { top: number; left: number } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const midY = r.top + r.height / 2 - h / 2;
  const midX = r.left + r.width / 2 - w / 2;
  const options = {
    top: { top: r.top - SPOT_PAD - GAP - h, left: midX },
    bottom: { top: r.top + r.height + SPOT_PAD + GAP, left: midX },
    left: { top: midY, left: r.left - SPOT_PAD - GAP - w },
    right: { top: midY, left: r.left + r.width + SPOT_PAD + GAP },
  };
  const flip = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
  const order = [side, flip[side], ...(['bottom', 'top', 'left', 'right'] as const).filter((s) => s !== side && s !== flip[side])];
  const fits = (p: { top: number; left: number }) => p.top >= GUTTER && p.left >= GUTTER && p.top + h <= vh - GUTTER && p.left + w <= vw - GUTTER;
  const clamp = (p: { top: number; left: number }) => ({
    top: Math.min(Math.max(p.top, GUTTER), vh - h - GUTTER),
    left: Math.min(Math.max(p.left, GUTTER), vw - w - GUTTER),
  });
  // Sideways placements only need to fit horizontally: sliding up or down keeps them beside the target.
  const sidewaysFit = (s: TourStep['side']) => {
    const p = options[s];
    return (s === 'left' || s === 'right') && p.left >= GUTTER && p.left + w <= vw - GUTTER;
  };
  for (const s of order) if (fits(options[s])) return options[s];
  for (const s of order) if (sidewaysFit(s)) return clamp(options[s]);
  // Nothing fits (a big target on a small screen): pin the card to the bottom of the screen.
  return { top: vh - h - GUTTER, left: Math.max(GUTTER, (vw - w) / 2) };
}
