import LatticeLoader from './reactbits/LatticeLoader';

/** Shown while waiting on the AI coach; the timer makes a 10-15s wait feel accounted for. */
export function CoachLoader({ label }: { label: string }) {
  return <LatticeLoader label={label} color="#8e97a3" cellSize={5} gap={2} fontSize={13} pattern="orbit" />;
}
