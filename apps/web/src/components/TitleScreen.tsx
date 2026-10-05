import { useState } from 'react';
import { signInWithGoogle, useAuth } from '../auth/auth';
import { AuthDialog, GoogleMark } from './AccountMenu';
import { PlayingCard } from './PlayingCard';

export function TitleScreen({ onGuest }: { onGuest: () => void }) {
  const { enabled } = useAuth();
  const [emailOpen, setEmailOpen] = useState(false);
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
          <p className="eyebrow">AI poker coach</p>
          <h1 className="brand title-brand">
            GTO<span>tutor</span>
          </h1>
          <p className="title-headline">Sharpen every decision.</p>
          <p className="title-lede">
            Solvers tell you what to do. Our AI coach tells you why. Play real spots, see the right play, and get the reasoning behind every action.
          </p>
          {enabled ? (
            <div className="title-cta">
              <button className="google-btn big" disabled={busy} onClick={() => void google()} autoFocus>
                <GoogleMark /> Continue with Google
              </button>
              {error && <p className="error small">{error}</p>}
              <button className="link" onClick={onGuest}>
                Continue as guest
              </button>
              <p className="muted small">
                Sign up anytime; your hands come with you. Prefer email?{' '}
                <button className="link" onClick={() => setEmailOpen(true)}>
                  Use email instead
                </button>
              </p>
            </div>
          ) : (
            <div className="title-cta">
              <button className="primary big" onClick={onGuest} autoFocus>
                Start training
              </button>
            </div>
          )}
          <p className="title-review">
            <span className="stars" aria-label="5 stars">
              ★★★★★
            </span>
            “Used by at least one guy.”
          </p>
        </div>
        <div className="title-art" aria-hidden>
          <PlayingCard card="As" className="gold fan fan-1" />
          <PlayingCard card="Ks" className="gold fan fan-2" />
        </div>
      </div>
      {emailOpen && <AuthDialog onClose={() => setEmailOpen(false)} />}
    </div>
  );
}
