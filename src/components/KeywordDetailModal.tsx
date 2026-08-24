import type { TrendHistoryPoint } from "@/lib/trends/history";
import { RankHistoryChart } from "@/components/RankHistoryChart";
import { FlatSignal } from "@/components/FlatSignal";

interface KeywordDetailModalProps {
  keyword: string;
  regionLabel: string;
  history: TrendHistoryPoint[] | undefined;
  onClose: () => void;
}

/**
 * The payoff view for tracking a keyword: a larger rank-over-time chart than
 * the inline sparkline. Reuses the history data page.tsx already fetches for
 * the sparklines/delta badges rather than a dedicated endpoint — the backend
 * track may add GET /api/trends/keyword-history in parallel; if it lands
 * with materially more resolution, migrate this to fetch it directly
 * (reconcile the same way history.ts/watchlist.ts were reconciled).
 */
export function KeywordDetailModal({ keyword, regionLabel, history, onClose }: KeywordDetailModalProps) {
  const points = history ?? [];
  const hasEnoughData = points.length >= 2;
  const currentRank = points.at(-1)?.rank;
  const bestRank = points.length > 0 ? Math.min(...points.map((p) => p.rank)) : undefined;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${keyword} 순위 추이`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-lg border border-hairline bg-surface p-6"
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-data text-[11px] uppercase tracking-widest text-signal">
              {regionLabel} · 순위 추이
            </p>
            <h2 className="mt-1 truncate font-display text-xl font-black tracking-tight text-text">
              {keyword}
            </h2>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 font-data text-text-dim hover:text-signal"
          >
            ✕
          </button>
        </div>

        {hasEnoughData ? (
          <>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-data text-xs text-text-dim">
              <span>
                현재 <strong className="text-text">{currentRank}위</strong>
              </span>
              <span>
                최고 <strong className="text-text">{bestRank}위</strong>
              </span>
              <span>스냅샷 {points.length}개</span>
            </div>
            <div className="mt-4">
              <RankHistoryChart points={points} />
            </div>
          </>
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-md border border-dashed border-hairline px-4 py-12 text-center">
            <FlatSignal />
            <p className="text-sm font-medium text-text">아직 데이터가 충분하지 않습니다</p>
            <p className="text-xs text-text-dim">스냅샷이 2개 이상 쌓이면 추이가 표시됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
