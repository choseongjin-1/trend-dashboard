interface RankDeltaProps {
  delta: number | null;
}

/**
 * Small rank-movement badge. Positive delta = moved up (better rank number).
 * Icon + number always ship together so meaning never depends on color alone.
 */
export function RankDelta({ delta }: RankDeltaProps) {
  if (delta === null) {
    return <span className="text-xs tabular-nums text-neutral-600">–</span>;
  }
  if (delta === 0) {
    return <span className="text-xs tabular-nums text-neutral-500">0</span>;
  }
  if (delta > 0) {
    return (
      <span className="text-xs tabular-nums text-emerald-400" title={`${delta}단계 상승`}>
        ▲{delta}
      </span>
    );
  }
  return (
    <span className="text-xs tabular-nums text-red-400" title={`${Math.abs(delta)}단계 하락`}>
      ▼{Math.abs(delta)}
    </span>
  );
}
