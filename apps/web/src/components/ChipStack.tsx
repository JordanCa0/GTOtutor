const DENOMINATIONS = [
  { value: 100, color: '#16181d', stripe: '#d4af37' },
  { value: 25, color: '#1f7a4d', stripe: '#f4efe2' },
  { value: 5, color: '#b3261e', stripe: '#f4efe2' },
  { value: 1, color: '#e9e4d8', stripe: '#2d5aa0' },
  { value: 0.5, color: '#c9982f', stripe: '#fff6dc' },
];
const MAX_DISCS = 7;
const STEP_PX = 3;

function discsFor(amount: number) {
  const discs: (typeof DENOMINATIONS)[number][] = [];
  let left = Math.round(amount * 2) / 2;
  for (const d of DENOMINATIONS) {
    while (left >= d.value - 1e-9 && discs.length < MAX_DISCS) {
      discs.push(d);
      left -= d.value;
    }
  }
  return discs.reverse();
}

export function ChipStack({ amount }: { amount: number }) {
  const discs = discsFor(amount);
  return (
    <span className="chip-stack" style={{ height: 11 + (discs.length - 1) * STEP_PX }} aria-hidden>
      {discs.map((d, i) => (
        <i key={i} style={{ bottom: i * STEP_PX, ['--chip' as string]: d.color, ['--stripe' as string]: d.stripe }} />
      ))}
    </span>
  );
}
