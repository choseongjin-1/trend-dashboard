import type { TrendHistoryPoint } from "@/lib/trends/history";
import { RankHistoryChart } from "@/components/RankHistoryChart";
import { EmptyFlaps } from "@/components/EmptyFlaps";

interface KeywordDetailModalProps {
  keyword: string;
  regionLabel: string;
  /** `undefined` while the dedicated history fetch is in flight. */
  history: TrendHistoryPoint[] | null | undefined;
  onClose: () => void;
}

/**
 * The payoff view for tracking a keyword: a larger rank-over-time chart than
 * the inline sparkline, backed by GET /api/trends/keyword-history.
 */
export function KeywordDetailModal({ keyword, regionLabel, history, onClose }: KeywordDetailModalProps) {
  const isLoading = history === undefined;
  const points = history ?? [];
  const hasEnoughData = !isLoading && points.length >= 2;
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
        className="w-full max-w-lg rounded-sm border border-ink-dim/20 bg-casing p-6 shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_10px_24px_rgba(24,27,30,0.15)]"
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-data text-[11px] uppercase tracking-widest text-ink-dim">
              {regionLabel} · 순위 추이
            </p>
            <h2 className="mt-1 truncate font-display text-xl text-ink">{keyword}</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="닫기"
            className="shrink-0 font-data text-ink-dim hover:text-ink"
          >
            ✕
          </button>
        </div>

        {hasEnoughData ? (
          <>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-data text-xs text-ink-dim">
              <span>
                현재 <strong className="text-ink">{currentRank}위</strong>
              </span>
              <span>
                최고 <strong className="text-ink">{bestRank}위</strong>
              </span>
              <span>스냅샷 {points.length}개</span>
            </div>
            <div className="mt-4">
              <RankHistoryChart points={points} />
            </div>
          </>
        ) : isLoading ? (
          <div className="mt-6 h-[200px] animate-pulse rounded-sm bg-paper/60" />
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-sm border border-dashed border-ink-dim/25 px-4 py-12 text-center">
            <EmptyFlaps />
            <p className="text-sm font-medium text-ink">아직 데이터가 충분하지 않습니다</p>
            <p className="text-xs text-ink-dim">스냅샷이 2개 이상 쌓이면 추이가 표시됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
