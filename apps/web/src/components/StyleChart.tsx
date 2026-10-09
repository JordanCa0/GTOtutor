import type { PlayerStyle, StylePoint } from '@gtotutor/shared-types';

const SIZE = 320;
const PAD = 28;
const HALF = (SIZE - PAD * 2) / 2;
/** Below this many decisions on an axis, the point is too uncertain to read much into. */
export const STYLE_MIN_DECISIONS = 30;

/**
 * Where the player sits against the charts: tight ↔ loose across, passive ↔ aggressive up.
 * The centre is playing like the charts; each point is percentage points of difference.
 */
export function StyleChart({ style }: { style: PlayerStyle }) {
  const { overall } = style;
  const points = [overall, ...style.bySpot];
  // Scale to fit the furthest point and its uncertainty, in steps of 10 points (at least ±20).
  const reach = Math.max(20, ...points.flatMap((p) => [Math.abs(p.x.value) + 1.96 * p.x.se, Math.abs(p.y.value) + 1.96 * p.y.se]));
  const range = Math.min(100, Math.ceil(reach / 10) * 10);
  const sx = (v: number) => SIZE / 2 + (v / range) * HALF;
  const sy = (v: number) => SIZE / 2 - (v / range) * HALF;
  const few = overall.x.n < STYLE_MIN_DECISIONS || overall.y.n < STYLE_MIN_DECISIONS;

  return (
    <figure className="style-chart">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={describe(overall)}>
        <rect className="style-frame" x={PAD} y={PAD} width={SIZE - PAD * 2} height={SIZE - PAD * 2} rx={8} />
        <line className="style-axis" x1={PAD} x2={SIZE - PAD} y1={SIZE / 2} y2={SIZE / 2} />
        <line className="style-axis" y1={PAD} y2={SIZE - PAD} x1={SIZE / 2} x2={SIZE / 2} />
        <text className="style-quadrant" x={PAD + 8} y={PAD + 16}>
          Tight-aggressive
        </text>
        <text className="style-quadrant" x={SIZE - PAD - 8} y={PAD + 16} textAnchor="end">
          Loose-aggressive
        </text>
        <text className="style-quadrant" x={PAD + 8} y={SIZE - PAD - 8}>
          Tight-passive
        </text>
        <text className="style-quadrant" x={SIZE - PAD - 8} y={SIZE - PAD - 8} textAnchor="end">
          Loose-passive
        </text>
        <text className="style-edge" x={SIZE / 2} y={PAD - 9} textAnchor="middle">
          More aggressive
        </text>
        <text className="style-edge" x={SIZE / 2} y={SIZE - 9} textAnchor="middle">
          More passive
        </text>
        <text className="style-edge" x={10} y={SIZE / 2} textAnchor="middle" transform={`rotate(-90 10 ${SIZE / 2})`}>
          Tighter
        </text>
        <text className="style-edge" x={SIZE - 10} y={SIZE / 2} textAnchor="middle" transform={`rotate(90 ${SIZE - 10} ${SIZE / 2})`}>
          Looser
        </text>
        <text className="style-centre" x={SIZE / 2 + 5} y={SIZE / 2 - 5}>
          GTO
        </text>

        {style.bySpot.map((p) => (
          <g key={p.spot} className="style-spot">
            <circle cx={sx(p.x.value)} cy={sy(p.y.value)} r={4} />
            <title>{`${p.label}: ${describe(p)}`}</title>
          </g>
        ))}

        <g className="style-player">
          {/* 95% range: where the true tendency most likely is, given how many decisions there are. */}
          <line x1={sx(overall.x.value - 1.96 * overall.x.se)} x2={sx(overall.x.value + 1.96 * overall.x.se)} y1={sy(overall.y.value)} y2={sy(overall.y.value)} />
          <line y1={sy(overall.y.value - 1.96 * overall.y.se)} y2={sy(overall.y.value + 1.96 * overall.y.se)} x1={sx(overall.x.value)} x2={sx(overall.x.value)} />
          <circle cx={sx(overall.x.value)} cy={sy(overall.y.value)} r={7} />
          <title>{`You: ${describe(overall)}`}</title>
        </g>
      </svg>
      <figcaption className="muted small">
        The centre is playing like the charts. Your dot is all your decisions; small dots are single spot types (hover for details). Each axis runs ±{range} points.
        {few && ` With fewer than ${STYLE_MIN_DECISIONS} decisions on an axis, treat the position as a rough guess.`}
      </figcaption>
    </figure>
  );
}

const lean = (v: number, minus: string, plus: string) => (Math.abs(v) < 1 ? 'on the charts' : `${Math.abs(v).toFixed(0)} points ${v < 0 ? minus : plus}`);

/** "6 points looser, 3 points more passive than the charts (120 and 80 decisions)". */
function describe(p: StylePoint): string {
  return `${lean(p.x.value, 'tighter', 'looser')}, ${lean(p.y.value, 'more passive', 'more aggressive')} (${p.x.n} and ${p.y.n} decisions)`;
}
