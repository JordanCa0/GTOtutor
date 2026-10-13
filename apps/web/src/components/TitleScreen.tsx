import type { PlayerStyle, StyleAxis } from '@gtotutor/shared-types';
import { useState, type CSSProperties } from 'react';
import { signInWithGoogle, useAuth } from '../auth/auth';
import { useSettings } from '../settings';
import { ACTION_COLORS } from './actionColors';
import { GoogleMark } from './AccountMenu';
import { ApproxIcon, SparklesIcon, StarIcon } from './icons';
import { PlayingCard } from './PlayingCard';
import { StylePlot } from './StyleChart';

export function TitleScreen({ onGuest }: { onGuest: () => void }) {
  const { enabled } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const google = async () => {
    setBusy(true);
    setError(null);
    const { error } = await signInWithGoogle();
    // On success the browser leaves for Google, so only a failure lands here.
    if (error) {
      setError(error.message);
      setBusy(false);
    }
  };

  return (
    <div className="title-screen">
      <div className="title-hero">
        <div className="title-copy">
          <h1 className="brand title-brand">
            GTO<span>tutor</span>
          </h1>
          <p className="title-headline">Learn the play, not just the answer.</p>
          <p className="title-lede">Play real spots, get graded against the chart, and ask the coach about any hand.</p>
          <div className="title-cta">
            <button className="primary big" onClick={onGuest}>
              Start a hand
            </button>
            {enabled && (
              <div className="title-save">
                <p className="label">Save your progress</p>
                <button className="google-btn" disabled={busy} onClick={() => void google()}>
                  <GoogleMark /> Continue with Google
                </button>
                {error && <p className="error small">{error}</p>}
                <p className="muted small">Sign up anytime; your hands come with you.</p>
              </div>
            )}
          </div>
          <p className="title-review">
            <span className="stars" role="img" aria-label="5 stars">
              {[0, 1, 2, 3, 4].map((i) => (
                <StarIcon key={i} size={14} />
              ))}
            </span>
            “Used by at least one guy.”
          </p>
        </div>
        <FeaturePreview />
      </div>
      <footer className="title-footer">
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
      </footer>
    </div>
  );
}

/** How long each slide stays up before the next one comes in. */
const SLIDE_MS = 6000;

const SLIDES = [
  { id: 'spot', label: 'Every decision graded' },
  { id: 'style', label: 'Your playing style' },
] as const;

/**
 * Made-up examples of what the trainer does, taking turns: a graded spot, then the style chart with
 * the coach's reading of it. Both slides share one grid cell, so the panel never changes height.
 * The active tab's progress bar is the timer, so pausing it (hover, keyboard focus) pauses the turn.
 * With reduced motion or animations off, slides only change from the tabs.
 */
function FeaturePreview() {
  const { animations } = useSettings();
  const [active, setActive] = useState(0);
  // Bumped each time a slide comes in: restarts the progress bar, and remounts the style chart so
  // its dots pop in again.
  const [shown, setShown] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const auto = animations && !reduced;

  const show = (i: number) => {
    setActive(i);
    setShown((n) => n + 1);
  };
  const next = () => {
    // In a background tab, start the bar over rather than turning unseen.
    if (document.hidden) setShown((n) => n + 1);
    else show((active + 1) % SLIDES.length);
  };

  return (
    <div
      className="title-preview"
      data-paused={paused || undefined}
      style={{ '--slide-ms': `${SLIDE_MS}ms` } as CSSProperties}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      // Only keyboard focus holds it: a clicked tab shouldn't stop the turning for good.
      onFocus={(e) => e.target.matches(':focus-visible') && setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="title-slides" aria-hidden>
        <div className="title-slide" data-active={active === 0 || undefined}>
          <SpotSlide />
        </div>
        <div className="title-slide" data-active={active === 1 || undefined}>
          <StyleSlide replay={active === 1 ? shown : 0} />
        </div>
      </div>
      <div className="title-slide-tabs" role="group" aria-label="What the trainer does">
        {SLIDES.map((s, i) => (
          <button key={s.id} className="title-slide-tab" aria-pressed={active === i} onClick={() => show(i)}>
            {s.label}
            {/* Fills over the slide's time; keyed so it starts over each time. */}
            {auto && active === i && <span key={shown} className="title-slide-progress" onAnimationEnd={next} />}
          </button>
        ))}
      </div>
    </div>
  );
}

const PREVIEW_OPTIONS = [
  { id: 'raise', label: '3-bet', pct: 54 },
  { id: 'call', label: 'Call', pct: 38, chosen: true },
  { id: 'fold', label: 'Fold', pct: 8 },
] as const;

/** A made-up graded spot: what a hand in the trainer looks like. */
function SpotSlide() {
  return (
    <>
      <div className="preview-spot" style={{ '--i': 0 } as CSSProperties}>
        <div className="spot-hand">
          <PlayingCard card="Kh" />
          <PlayingCard card="Jh" />
        </div>
        <div>
          <p className="preview-situation">CO opens to 2.5bb.</p>
          <p className="muted small">You're on the button with KJs.</p>
        </div>
      </div>

      <div className="verdict verdict-mixed" style={{ '--i': 1 } as CSSProperties}>
        <span className="verdict-icon">
          <ApproxIcon size={18} />
        </span>
        <div className="verdict-body">
          <div className="verdict-title">
            <h2>Fine. The chart mixes here.</h2>
          </div>
          <div className="pills">
            {PREVIEW_OPTIONS.map((o) => (
              <span key={o.id} className={`pill ${'chosen' in o ? 'chosen' : ''}`} style={{ ['--c' as string]: ACTION_COLORS[o.id] }}>
                {'chosen' in o && <em>You</em>}
                {o.label} <b>{o.pct}%</b>
              </span>
            ))}
          </div>
          <p className="verdict-detail">The chart prefers 3-bet (54%) but plays Call 38% of the time.</p>
        </div>
      </div>

      <div className="preview-coach" style={{ '--i': 2 } as CSSProperties}>
        <span className="coach-avatar">
          <SparklesIcon size={15} />
        </span>
        <p className="bubble-tldr">
          <span className="tldr-label">TL;DR</span>
          <strong>KJs blocks CO's best broadways and takes the initiative, so 3-betting earns a little more.</strong>
        </p>
      </div>
    </>
  );
}

/** One made-up axis: the player's rate is `value` points off the charts' `chart`. */
const axis = (chart: number, value: number, n: number): StyleAxis => ({ value, n, se: 2, you: chart + value, chart });
const PREVIEW_LEAKS = { playedChartFolds: { rate: 18, weight: 40 }, foldedChartPlays: { rate: 6, weight: 40 } };

/** A loose-passive player whose recent hands have drifted back toward the charts (a green arrow). */
const PREVIEW_STYLE: PlayerStyle = {
  overall: { x: axis(38, 8, 240), y: axis(16, -6, 240) },
  bySpot: [
    { spot: 'RFI', label: 'Opening', x: axis(30, 4, 80), y: axis(30, 2, 80) },
    { spot: 'VS_OPEN', label: 'Facing an open', x: axis(26, 11, 70), y: axis(12, -9, 70) },
    { spot: 'VS_3BET', label: 'Facing a 3-bet', x: axis(45, 6, 30), y: axis(20, -11, 30) },
    { spot: 'FLOP', label: 'Flop', x: axis(60, -3, 60), y: axis(35, -4, 60) },
  ],
  leaks: PREVIEW_LEAKS,
};
const PREVIEW_RECENT: PlayerStyle = { overall: { x: axis(38, 3, 40), y: axis(16, -2, 40) }, bySpot: [], leaks: PREVIEW_LEAKS };

/** The style chart from the profile, with the coach's reading of it. */
function StyleSlide({ replay }: { replay: number }) {
  return (
    <>
      <div className="preview-style" style={{ '--i': 0 } as CSSProperties}>
        <StylePlot key={replay} style={PREVIEW_STYLE} recent={PREVIEW_RECENT} />
        <div className="preview-style-reading">
          <p className="style-headline">You play looser and more passive than the charts.</p>
          <ul className="style-leaks">
            <li>
              <span>Played hands the charts fold</span>
              <b>18%</b>
            </li>
            <li>
              <span>Folded hands the charts play</span>
              <b>6%</b>
            </li>
          </ul>
        </div>
      </div>

      <div className="preview-coach" style={{ '--i': 1 } as CSSProperties}>
        <span className="coach-avatar">
          <SparklesIcon size={15} />
        </span>
        <p className="bubble-tldr">
          <span className="tldr-label">TL;DR</span>
          <strong>You call too many opens. 3-bet your best suited hands instead, and let the weakest ones go.</strong>
        </p>
      </div>
    </>
  );
}
