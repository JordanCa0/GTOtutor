const SUIT_SYMBOLS: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };

export function PlayingCard({ card, size = 'md' }: { card: string | null; size?: 'sm' | 'md' }) {
  if (!card) return <span className={`card card-${size} card-back`} aria-label="hidden card" />;
  const rank = card[0] === 'T' ? '10' : card[0];
  const suit = card[1];
  const red = suit === 'h' || suit === 'd';
  return (
    <span className={`card card-${size} ${red ? 'card-red' : ''}`} aria-label={card}>
      <span className="card-rank">{rank}</span>
      <span className="card-suit">{SUIT_SYMBOLS[suit]}</span>
    </span>
  );
}
