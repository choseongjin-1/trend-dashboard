import { TrendHistoryPoint } from "@/lib/trends/history";

interface RankSparklineProps {
  history: TrendHistoryPoint[];
  width?: number;
  height?: number;
}

/**
 * Tiny inline sparkline of a keyword's rank over time.
 *
 * Rank is an "inverted" metric — a lower number is better. We flip the y-axis
 * (plot `maxRank - rank`) so an upward-sloping line always reads as
 * "improving," matching the up-is-good convention used everywhere else
 * (delta arrows, colors).
 */
export function RankSparkline({ history, width = 56, height = 20 }: RankSparklineProps) {
  if (history.length < 2) return null;

  const ranks = history.map((point) => point.rank);
  const maxRank = Math.max(...ranks);
  const minRank = Math.min(...ranks);
  const span = Math.max(maxRank - minRank, 1);
  const padding = 2;

  const coords = history.map((point, i) => {
    const x = (i / (history.length - 1)) * (width - padding * 2) + padding;
    const inverted = maxRank - point.rank; // higher value = better rank
    const normalized = (inverted / span) * (height - padding * 2);
    const y = height - padding - normalized;
    return { x, y };
  });

  const path = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
      role="img"
      aria-label="최근 순위 추이"
    >
      <polyline
        points={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-flap-dim"
      />
      <circle cx={last.x} cy={last.y} r={1.75} fill="currentColor" className="text-flap" />
    </svg>
  );
}
