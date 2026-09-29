import { ChipStack } from './ChipStack';
import { PlayingCard } from './PlayingCard';

const FEATURES = [
  { title: 'Play real spots', body: 'Hands dealt at a 6-max table and played out to showdown, one decision at a time.' },
  { title: 'Instant verdicts', body: 'See how every decision compares to the range chart, with the full range at a glance.' },
  { title: 'AI coach', body: 'Get a quick TL;DR on any spot, ask follow-ups, and review your leaks after a session.' },
];

export function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="title-screen">
      <div className="title-hero">
        <div className="title-copy">
          <p className="eyebrow">Preflop poker trainer</p>
          <h1 className="brand title-brand">
            GTO<span>tutor</span>
          </h1>
          <p className="title-headline">Sharpen every preflop decision.</p>
          <p className="title-lede">Practice preflop decisions and learn strategy from our AI coach. Find your leaks and improve your game.</p>
          <button className="primary big" onClick={onStart} autoFocus>
            Start training
          </button>
          <p className="muted small">6-max cash · 100bb · more formats coming</p>
        </div>
        <div className="title-art" aria-hidden>
          <div className="title-felt" />
          <PlayingCard card="As" className="fan fan-1" />
          <PlayingCard card="Ks" className="fan fan-2" />
          <div className="title-chips">
            <ChipStack amount={100} />
            <ChipStack amount={31} />
            <ChipStack amount={6.5} />
          </div>
        </div>
      </div>
      <div className="title-features">
        {FEATURES.map((f) => (
          <div key={f.title} className="feature">
            <strong>{f.title}</strong>
            <p>{f.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
