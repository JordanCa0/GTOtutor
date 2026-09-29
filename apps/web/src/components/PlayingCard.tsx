import type { CSSProperties } from 'react';

const SUIT_SYMBOLS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

interface Props {
  card: string | null;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  style?: CSSProperties;
}

export function PlayingCard({ card, size = 'md', className = '', style }: Props) {
  if (!card) return <span className={`card card-${size} card-back ${className}`} style={style} aria-label="hidden card" />;
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = SUIT_SYMBOLS[card[1]];
  const red = card[1] === 'h' || card[1] === 'd';
  return (
    <span className={`card card-${size} ${red ? 'card-red' : ''} ${className}`} style={style} aria-label={card}>
      <span className="card-index">
        <span>{rank}</span>
        <span>{suit}</span>
      </span>
      <span className="card-pip">{suit}</span>
    </span>
  );
}
