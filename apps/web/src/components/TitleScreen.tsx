import { useState } from 'react';
import { signInWithGoogle, useAuth } from '../auth/auth';
import { ACTION_COLORS } from './actionColors';
import { GoogleMark } from './AccountMenu';
import { ApproxIcon, SparklesIcon, StarIcon } from './icons';
import { PlayingCard } from './PlayingCard';

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
        <SpotPreview />
      </div>
      <footer className="title-footer">
        <a href="/privacy.html">Privacy</a>
        <a href="/terms.html">Terms</a>
      </footer>
    </div>
  );
}

const PREVIEW_OPTIONS = [
  { id: 'raise', label: '3-bet', pct: 54 },
  { id: 'call', label: 'Call', pct: 38, chosen: true },
  { id: 'fold', label: 'Fold', pct: 8 },
] as const;

/** A static, made-up graded spot: what a hand in the trainer looks like. */
function SpotPreview() {
  return (
    <div className="title-preview" aria-hidden>
      <div className="preview-spot">
        <div className="spot-hand">
          <PlayingCard card="Kh" />
          <PlayingCard card="Jh" />
        </div>
        <div>
          <p className="preview-situation">CO opens to 2.5bb.</p>
          <p className="muted small">You're on the button with KJs.</p>
        </div>
      </div>

      <div className="verdict verdict-mixed">
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

      <div className="preview-coach">
        <span className="coach-avatar">
          <SparklesIcon size={15} />
        </span>
        <p className="bubble-tldr">
          <span className="tldr-label">TL;DR</span>
          <strong>KJs blocks CO's best broadways and takes the initiative, so 3-betting earns a little more.</strong>
        </p>
      </div>
    </div>
  );
}
