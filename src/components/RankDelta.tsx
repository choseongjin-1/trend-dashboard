interface RankDeltaProps {
  delta: number | null;
}

/**
 * Small rank-movement badge. Positive delta = moved up (better rank number).
 * Icon + number always ship together so meaning never depends on color alone.
 * rising/falling are reserved for exactly this — no other UI element uses them.
 */
export function RankDelta({ delta }: RankDeltaProps) {
  if (delta === null) {
    return <span className="font-data text-xs tabular-nums text-flap-dim/60">–</span>;
  }
  if (delta === 0) {
    return <span className="font-data text-xs tabular-nums text-flap-dim">0</span>;
  }
  if (delta > 0) {
    return (
      <span className="font-data text-xs tabular-nums text-rising" title={`${delta}단계 상승`}>
        ▲{delta}
      </span>
    );
  }
  return (
    <span className="font-data text-xs tabular-nums text-falling" title={`${Math.abs(delta)}단계 하락`}>
      ▼{Math.abs(delta)}
    </span>
  );
}
