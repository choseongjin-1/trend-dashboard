"use client";

import { useState } from "react";
import type { TrendHistoryPoint } from "@/lib/trends/history";
import { RankHistoryChart } from "@/components/RankHistoryChart";
import { EmptyFlaps } from "@/components/EmptyFlaps";
import { useModalA11y } from "@/hooks/useModalA11y";

interface KeywordDetailModalProps {
  keyword: string;
  regionLabel: string;
  /** `undefined` while the dedicated history fetch is in flight. */
  history: TrendHistoryPoint[] | null | undefined;
  onClose: () => void;
}

/**
 * The payoff view for tracking a keyword: a larger rank-over-time chart than
 * the inline sparkline, backed by GET /api/trends/keyword-history. Always
 * mounted only while it should be open (parent conditionally renders it), so
 * `useModalA11y` uses its default `open = true` — the mount/unmount cycle
 * itself is the open/close transition.
 */
export function KeywordDetailModal({ keyword, regionLabel, history, onClose }: KeywordDetailModalProps) {
  const containerRef = useModalA11y(onClose);
  const [shareState, setShareState] = useState<"idle" | "copied">("idle");
  const isLoading = history === undefined;
  const points = history ?? [];
  const hasEnoughData = !isLoading && points.length >= 2;
  const currentRank = points.at(-1)?.rank;
  const bestRank = points.length > 0 ? Math.min(...points.map((p) => p.rank)) : undefined;

  const handleShare = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: `${keyword} 순위 추이 - FLIP`, url });
        return;
      } catch {
        // Cancelled or unsupported mid-call — fall through to clipboard copy.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2000);
    } catch {
      // Clipboard unavailable (permissions, insecure context) — no-op, same
      // defensive discipline as the rest of the app: never crash on a
      // best-effort affordance.
    }
  };

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`${keyword} 순위 추이`}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg rounded-sm border border-flap-dim/20 bg-panel p-6 shadow-[0_1px_0_rgba(255,255,255,0.04)_inset,0_10px_30px_rgba(0,0,0,0.5)]"
      >
        <div className="mb-1 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-data text-[11px] uppercase tracking-widest text-flap-dim">
              {regionLabel} · 순위 추이
            </p>
            <h2 className="mt-1 truncate font-display text-xl text-flap">{keyword}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={handleShare}
              className="font-data text-[11px] text-flap-dim hover:text-flap"
            >
              {shareState === "copied" ? "복사됨" : "공유"}
            </button>
            <button
              onClick={onClose}
              aria-label="닫기"
              className="font-data text-flap-dim hover:text-flap"
            >
              ✕
            </button>
          </div>
        </div>

        {hasEnoughData ? (
          <>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 font-data text-xs text-flap-dim">
              <span>
                현재 <strong className="text-flap">{currentRank}위</strong>
              </span>
              <span>
                최고 <strong className="text-flap">{bestRank}위</strong>
              </span>
              <span>스냅샷 {points.length}개</span>
            </div>
            <div className="mt-4">
              <RankHistoryChart points={points} />
            </div>
          </>
        ) : isLoading ? (
          <div className="mt-6 h-[200px] animate-pulse rounded-sm bg-casing/60" />
        ) : (
          <div className="mt-6 flex flex-col items-center gap-3 rounded-sm border border-dashed border-flap-dim/25 px-4 py-12 text-center">
            <EmptyFlaps />
            <p className="text-sm font-medium text-flap">아직 데이터가 충분하지 않습니다</p>
            <p className="text-xs text-flap-dim">스냅샷이 2개 이상 쌓이면 추이가 표시됩니다.</p>
          </div>
        )}
      </div>
    </div>
  );
}
