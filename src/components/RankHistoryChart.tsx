"use client";

import { useMemo, useState } from "react";
import type { TrendHistoryPoint } from "@/lib/trends/history";

interface RankHistoryChartProps {
  points: TrendHistoryPoint[];
}

const WIDTH = 480;
const HEIGHT = 200;
const PAD_LEFT = 30;
const PAD_RIGHT = 10;
const PAD_TOP = 22;
const PAD_BOTTOM = 26;
const TICK_COUNT = 3;

function formatShort(iso: string) {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Larger, detailed rank-over-time chart for a single keyword — the payoff
 * view for tracking something on the watchlist. Unlike RankSparkline this
 * has a real y-axis (actual rank numbers, not just a shape), a hover
 * crosshair + tooltip, and a persistent label on the latest point.
 *
 * Single series, so no categorical palette: the line/dots use the `flap`
 * (cream) ink color like a trace printed on the board, not the rising/
 * falling status hues — those are reserved for delta badges elsewhere.
 */
export function RankHistoryChart({ points }: RankHistoryChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const chart = useMemo(() => {
    if (points.length < 2) return null;

    const ranks = points.map((p) => p.rank);
    const rawMin = Math.min(...ranks);
    const rawMax = Math.max(...ranks);
    const span = Math.max(rawMax - rawMin, 1);
    const paddedMin = Math.max(1, rawMin - Math.ceil(span * 0.2));
    const paddedMax = rawMax + Math.ceil(span * 0.2);
    const range = Math.max(paddedMax - paddedMin, 1);

    const innerW = WIDTH - PAD_LEFT - PAD_RIGHT;
    const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;

    // Lower rank number (better) maps to a smaller y — visually "higher" on the chart.
    const rankToY = (rank: number) => PAD_TOP + ((rank - paddedMin) / range) * innerH;

    const coords = points.map((p, i) => ({
      x: PAD_LEFT + (points.length > 1 ? (i / (points.length - 1)) * innerW : innerW / 2),
      y: rankToY(p.rank),
      point: p,
    }));

    const rawTicks = Array.from({ length: TICK_COUNT }, (_, i) => {
      const rank = Math.round(paddedMin + (range * i) / (TICK_COUNT - 1));
      return { rank, y: rankToY(rank) };
    });
    // A narrow rank range (e.g. a keyword that's stayed at #1 the whole
    // time) can round two ticks to the same value — drop the duplicate
    // rather than rendering/keying two identical labels.
    const yTicks = rawTicks.filter((tick, i) => i === 0 || tick.rank !== rawTicks[i - 1].rank);

    return { coords, yTicks, innerH };
  }, [points]);

  if (!chart) return null;
  const { coords, yTicks } = chart;
  const last = coords[coords.length - 1];
  const hovered = hoverIndex !== null ? coords[hoverIndex] : null;

  const linePath = coords.map((c) => `${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" L ");

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    let nearestDist = Infinity;
    coords.forEach((c, i) => {
      const d = Math.abs(c.x - x);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    setHoverIndex(nearest);
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none"
        aria-hidden="true"
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIndex(null)}
      >
        {yTicks.map((tick) => (
          <g key={tick.rank}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={tick.y}
              y2={tick.y}
              stroke="var(--flap-dim)"
              strokeWidth={1}
              opacity={0.2}
            />
            <text x={PAD_LEFT - 6} y={tick.y} textAnchor="end" dominantBaseline="middle" className="fill-flap-dim font-data" fontSize={9}>
              {tick.rank}
            </text>
          </g>
        ))}

        <polyline points={linePath} fill="none" stroke="var(--flap)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />

        {coords.map((c, i) => (
          <circle key={i} cx={c.x} cy={c.y} r={i === coords.length - 1 ? 3.5 : 2.5} fill="var(--flap)" opacity={i === coords.length - 1 ? 1 : 0.6} />
        ))}

        <text x={last.x} y={last.y - 10} textAnchor="end" className="fill-flap font-data" fontSize={11} fontWeight={700}>
          {last.point.rank}위
        </text>

        <text x={PAD_LEFT} y={HEIGHT - 6} className="fill-flap-dim font-data" fontSize={9}>
          {formatShort(coords[0].point.fetchedAt)}
        </text>
        <text x={WIDTH - PAD_RIGHT} y={HEIGHT - 6} textAnchor="end" className="fill-flap-dim font-data" fontSize={9}>
          {formatShort(last.point.fetchedAt)}
        </text>

        {hovered && (
          <line x1={hovered.x} x2={hovered.x} y1={PAD_TOP} y2={HEIGHT - PAD_BOTTOM} stroke="var(--flap)" strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-sm border border-flap-dim/25 bg-casing px-2 py-1 font-data text-[10px] text-flap shadow-sm"
          style={{ left: `${(hovered.x / WIDTH) * 100}%`, top: `${(hovered.y / HEIGHT) * 100}%`, marginTop: -8 }}
        >
          {hovered.point.rank}위 · {formatShort(hovered.point.fetchedAt)}
        </div>
      )}

      {/* The SVG above is aria-hidden — this table is the real data for
          screen readers, not a decorative fallback. */}
      <table className="sr-only">
        <caption>순위 추이 데이터</caption>
        <thead>
          <tr>
            <th scope="col">시간</th>
            <th scope="col">순위</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => (
            <tr key={i}>
              <td>{formatShort(p.fetchedAt)}</td>
              <td>{p.rank}위</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
