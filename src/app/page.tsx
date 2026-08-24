"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendsResponse } from "@/lib/trends/types";
import { fetchTrendsHistory, toHistoryMap, computeDelta, TrendHistoryPoint } from "@/lib/trends/history";
import { fetchKeywordHistory } from "@/lib/trends/keywordHistory";
import { REGIONS, DEFAULT_REGION } from "@/lib/trends/regions";
import { sourceLabel } from "@/lib/trends/sourceLabel";
import { fetchWatchlist, addToWatchlist, removeFromWatchlist, WatchlistRow } from "@/lib/watchlist";
import { useAuth } from "@/lib/auth/useAuth";
import { RankDelta } from "@/components/RankDelta";
import { RankSparkline } from "@/components/RankSparkline";
import { AuthHeader } from "@/components/AuthHeader";
import { AuthModal } from "@/components/AuthModal";
import { RegionTabs } from "@/components/RegionTabs";
import { WatchlistPanel } from "@/components/WatchlistPanel";
import { EmptyFlaps } from "@/components/EmptyFlaps";
import { KeywordDetailModal } from "@/components/KeywordDetailModal";

export default function Home() {
  const [region, setRegion] = useState<string>(DEFAULT_REGION);
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyMap, setHistoryMap] = useState<Map<string, TrendHistoryPoint[]>>(new Map());
  // Bumped on every successful load so the row list remounts and replays the
  // flap-in animation — the board "re-tallies" on refresh, like a real one.
  const [revision, setRevision] = useState(0);

  const auth = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [detailKeyword, setDetailKeyword] = useState<string | null>(null);
  const [detailHistory, setDetailHistory] = useState<TrendHistoryPoint[] | null | undefined>(undefined);
  // null = watchlist feature unavailable (logged out, or the API failed) — hide its UI entirely.
  const [watchlist, setWatchlist] = useState<WatchlistRow[] | null>(null);

  const load = useCallback(async (targetRegion: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trends?region=${encodeURIComponent(targetRegion)}`);
      if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
      const json = (await res.json()) as TrendsResponse;
      setData(json);
      setRevision((r) => r + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류");
      setLoading(false);
      return;
    }
    setLoading(false);

    // History is a best-effort enhancement backed by a separate endpoint that
    // may not exist yet (or may return an unexpected shape). Any failure here
    // must never surface as a page error — just skip the history UI.
    const history = await fetchTrendsHistory(targetRegion);
    setHistoryMap(toHistoryMap(history));
  }, []);

  useEffect(() => {
    // Refetch whenever the selected region changes (including initial mount).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load(region);
  }, [load, region]);

  useEffect(() => {
    // Watchlist is only meaningful when logged in; a fetch failure (route
    // missing, network error, malformed body) also resolves to null so the
    // affordance stays hidden rather than showing a broken feature.
    if (!auth.user) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setWatchlist(null);
      return;
    }
    let cancelled = false;
    fetchWatchlist().then((rows) => {
      if (!cancelled) setWatchlist(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  useEffect(() => {
    if (!detailKeyword) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDetailHistory(undefined);
    fetchKeywordHistory(detailKeyword, region).then((points) => {
      if (!cancelled) setDetailHistory(points);
    });
    return () => {
      cancelled = true;
    };
  }, [detailKeyword, region]);

  // A keyword can be tracked per-region, so "watched" for the currently
  // displayed list means an entry matching both keyword and active region.
  const toggleWatch = useCallback(
    async (keyword: string) => {
      if (watchlist === null) return;
      const existing = watchlist.find((w) => w.keyword === keyword && w.region === region);
      if (existing) {
        const ok = await removeFromWatchlist(existing.id);
        if (!ok) return;
        setWatchlist((prev) => (prev === null ? prev : prev.filter((w) => w.id !== existing.id)));
      } else {
        const created = await addToWatchlist(keyword, region);
        if (!created) return;
        setWatchlist((prev) => (prev === null ? prev : [...prev, created]));
      }
    },
    [watchlist, region],
  );

  const removeWatchlistEntry = useCallback(async (id: string) => {
    const ok = await removeFromWatchlist(id);
    if (!ok) return;
    setWatchlist((prev) => (prev === null ? prev : prev.filter((w) => w.id !== id)));
  }, []);

  const isEmpty = !!data && data.items.length === 0;
  const watchlistAvailable = !!auth.user && watchlist !== null;
  // Show a per-item source tag only once it's actually informative — no
  // point stamping "YouTube" on every row while that's the only source.
  // The moment a second source starts flowing, this switches on by itself.
  const hasMultipleSources = !!data && new Set(data.items.map((item) => item.source)).size > 1;

  return (
    <div className="min-h-screen bg-paper text-ink">
      <div className="border-b border-ink-dim/20 bg-casing">
        <div className="mx-auto max-w-2xl px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <span className="font-display text-xl tracking-wide text-ink">FLIP</span>
              <RegionTabs regions={REGIONS} active={region} onChange={setRegion} />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => load(region)}
                disabled={loading}
                className="rounded-sm border border-ink-dim/20 px-3 py-1.5 font-data text-xs text-ink-dim transition hover:border-ink-dim/40 hover:text-ink disabled:opacity-50"
              >
                {loading ? "갱신 중..." : "갱신"}
              </button>
              <AuthHeader
                user={auth.user}
                loading={auth.loading}
                onSignOut={auth.signOut}
                onOpenAuth={() => setAuthModalOpen(true)}
              />
            </div>
          </div>
          <p className="mt-2 font-body text-xs text-ink-dim">
            인기 급상승 신호를 실시간으로 감지하는 키워드 보드
          </p>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-6 py-6">
        {data?.mocked && (
          <div className="mb-4 rounded-sm border border-ink-dim/25 bg-casing px-3 py-2 text-sm text-ink-dim">
            목업 데이터 표시 중입니다. 실제 데이터가 연결되면 자동으로 전환됩니다.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-sm border border-falling/50 bg-falling/10 px-3 py-2 text-sm text-falling"
          >
            오류: {error}
          </div>
        )}

        {loading && !data && (
          <div className="space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-11 animate-pulse rounded-sm bg-casing" />
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-3 rounded-sm border border-dashed border-ink-dim/25 px-4 py-14 text-center">
            <EmptyFlaps />
            <p className="text-sm font-medium text-ink">표시할 키워드가 없습니다</p>
            <p className="text-xs text-ink-dim">잠시 후 다시 갱신해보세요.</p>
            <button
              onClick={() => load(region)}
              className="mt-2 rounded-sm border border-ink-dim/20 px-3 py-1.5 text-xs text-ink-dim hover:border-ink-dim/40 hover:text-ink"
            >
              갱신
            </button>
          </div>
        )}

        {watchlistAvailable && (
          <WatchlistPanel entries={watchlist ?? []} onRemove={removeWatchlistEntry} />
        )}

        {data && !isEmpty && (
          <ol key={revision} className="flex flex-col gap-1">
            {data.items.map((item, i) => {
              const history = historyMap.get(item.keyword);
              const delta = computeDelta(history);
              const isWatched =
                watchlistAvailable &&
                (watchlist ?? []).some((w) => w.keyword === item.keyword && w.region === region);
              return (
                <li
                  key={item.rank}
                  className="flap-row flex items-center gap-3 rounded-sm border border-ink-dim/10 bg-casing px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset,0_1px_2px_rgba(24,27,30,0.08)]"
                  style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                >
                  <span className="w-6 text-right font-data text-base font-bold text-ink-dim">
                    {item.rank}
                  </span>
                  {watchlistAvailable && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleWatch(item.keyword);
                      }}
                      aria-label={isWatched ? "워치리스트에서 제거" : "워치리스트에 추가"}
                      aria-pressed={isWatched}
                      className={`shrink-0 -m-1 p-1 text-base leading-none ${isWatched ? "text-ink" : "text-ink-dim/50 hover:text-ink"}`}
                    >
                      {isWatched ? "★" : "☆"}
                    </button>
                  )}
                  <button
                    onClick={() => setDetailKeyword(item.keyword)}
                    className="min-w-0 flex-1 truncate py-1 text-left font-data text-sm text-ink hover:text-ink/80"
                  >
                    {item.keyword}
                  </button>
                  {hasMultipleSources && (
                    <span className="shrink-0 rounded-sm border border-ink-dim/20 px-1.5 py-0.5 font-data text-[10px] uppercase tracking-wide text-ink-dim">
                      {sourceLabel(item.source)}
                    </span>
                  )}
                  {historyMap.size > 0 && (
                    <>
                      {history && <RankSparkline history={history} />}
                      <span className="w-9 text-right">
                        <RankDelta delta={delta} />
                      </span>
                    </>
                  )}
                  <span className="font-data text-xs text-ink-dim">
                    {item.score.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {data && (
          <p className="mt-4 flex items-center gap-1.5 font-data text-[11px] text-ink-dim">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-rising" aria-hidden="true" />
            마지막 갱신: {new Date(data.fetchedAt).toLocaleString()}
          </p>
        )}
      </div>

      <AuthModal
        open={authModalOpen}
        error={auth.error}
        onClose={() => setAuthModalOpen(false)}
        onSignIn={auth.signIn}
        onSignUp={auth.signUp}
      />

      {detailKeyword && (
        <KeywordDetailModal
          keyword={detailKeyword}
          regionLabel={REGIONS.find((r) => r.code === region)?.label ?? region}
          history={detailHistory}
          onClose={() => setDetailKeyword(null)}
        />
      )}
    </div>
  );
}
