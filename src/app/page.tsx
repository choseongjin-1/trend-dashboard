"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendsResponse } from "@/lib/trends/types";
import { fetchTrendsHistory, toHistoryMap, computeDelta, TrendHistoryPoint } from "@/lib/trends/history";
import { REGIONS, DEFAULT_REGION } from "@/lib/trends/regions";
import { fetchWatchlist, addToWatchlist, removeFromWatchlist } from "@/lib/watchlist";
import { useAuth } from "@/lib/auth/useAuth";
import { RankDelta } from "@/components/RankDelta";
import { RankSparkline } from "@/components/RankSparkline";
import { SpikeLine } from "@/components/SpikeLine";
import { AuthHeader } from "@/components/AuthHeader";
import { AuthModal } from "@/components/AuthModal";
import { RegionTabs } from "@/components/RegionTabs";
import { WatchlistPanel } from "@/components/WatchlistPanel";

export default function Home() {
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyMap, setHistoryMap] = useState<Map<string, TrendHistoryPoint[]>>(new Map());

  const auth = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  // null = watchlist feature unavailable (logged out, or the API failed) — hide its UI entirely.
  const [watchlist, setWatchlist] = useState<string[] | null>(null);

  const load = useCallback(async (targetRegion: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/trends?region=${encodeURIComponent(targetRegion)}`);
      if (!res.ok) throw new Error(`요청 실패 (${res.status})`);
      const json = (await res.json()) as TrendsResponse;
      setData(json);
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
    fetchWatchlist().then((keywords) => {
      if (!cancelled) setWatchlist(keywords);
    });
    return () => {
      cancelled = true;
    };
  }, [auth.user]);

  const toggleWatch = useCallback(
    async (keyword: string) => {
      if (watchlist === null) return;
      const isWatched = watchlist.includes(keyword);
      const ok = isWatched ? await removeFromWatchlist(keyword) : await addToWatchlist(keyword);
      if (!ok) return;
      setWatchlist((prev) =>
        prev === null
          ? prev
          : isWatched
            ? prev.filter((k) => k !== keyword)
            : [...prev, keyword],
      );
    },
    [watchlist],
  );

  const isEmpty = !!data && data.items.length === 0;
  const watchlistAvailable = !!auth.user && watchlist !== null;

  return (
    <div className="min-h-screen bg-bg px-6 py-8 text-text">
      <div className="mx-auto max-w-2xl">
        <header className="mb-6 flex items-center justify-between">
          <span className="font-display text-lg font-black tracking-tight text-signal">SPIKE</span>
          <AuthHeader
            user={auth.user}
            loading={auth.loading}
            onSignOut={auth.signOut}
            onOpenAuth={() => setAuthModalOpen(true)}
          />
        </header>

        <section className="mb-8">
          <SpikeLine />
          <h1 className="mt-3 font-display text-2xl font-bold leading-tight text-text sm:text-3xl">
            지금, 가장 먼저 뜨는 키워드
          </h1>
          <p className="mt-2 text-sm text-text-dim">
            YouTube 인기 급상승 신호를 실시간으로 감지해 랭킹으로 보여드립니다. 워치리스트에
            담아두면 순위가 바뀔 때마다 가장 먼저 알 수 있어요.
          </p>
        </section>

        <div className="mb-5 flex items-center justify-between gap-4">
          <RegionTabs regions={REGIONS} active={region} onChange={setRegion} />
          <button
            onClick={() => load(region)}
            disabled={loading}
            className="shrink-0 rounded-md bg-surface-2 px-3 py-1.5 text-sm text-text transition hover:bg-surface disabled:opacity-50"
          >
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>

        {data?.mocked && (
          <div className="mb-4 rounded-md border border-signal-dim/60 bg-signal/10 px-3 py-2 text-sm text-signal">
            목업 데이터 표시 중입니다. YOUTUBE_API_KEY를 설정하면 실제 데이터로 전환됩니다.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-fall/50 bg-fall/10 px-3 py-2 text-sm text-fall"
          >
            오류: {error}
          </div>
        )}

        {loading && !data && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-surface" />
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-hairline px-4 py-14 text-center">
            <span className="text-3xl">🔍</span>
            <p className="text-sm font-medium text-text">표시할 랭킹 데이터가 없습니다</p>
            <p className="text-xs text-text-dim">
              잠시 후 다시 시도하거나 새로고침 버튼을 눌러주세요.
            </p>
            <button
              onClick={() => load(region)}
              className="mt-2 rounded-md bg-surface-2 px-3 py-1.5 text-xs text-text hover:bg-surface"
            >
              다시 시도
            </button>
          </div>
        )}

        {watchlistAvailable && <WatchlistPanel keywords={watchlist ?? []} onRemove={toggleWatch} />}

        {data && !isEmpty && (
          <ol className="divide-y divide-hairline rounded-md border border-hairline">
            {data.items.map((item) => {
              const history = historyMap.get(item.keyword);
              const delta = computeDelta(history);
              const isWatched = watchlistAvailable && (watchlist ?? []).includes(item.keyword);
              return (
                <li key={item.rank} className="flex items-center gap-4 px-4 py-3">
                  <span className="w-6 text-right font-data text-sm font-medium text-text-dim">
                    {item.rank}
                  </span>
                  {watchlistAvailable && (
                    <button
                      onClick={() => toggleWatch(item.keyword)}
                      aria-label={isWatched ? "워치리스트에서 제거" : "워치리스트에 추가"}
                      aria-pressed={isWatched}
                      className={`shrink-0 text-base leading-none ${isWatched ? "text-signal" : "text-text-dim hover:text-signal"}`}
                    >
                      {isWatched ? "★" : "☆"}
                    </button>
                  )}
                  <span className="flex-1 text-sm">{item.keyword}</span>
                  {historyMap.size > 0 && (
                    <>
                      {history && <RankSparkline history={history} />}
                      <span className="w-9 text-right">
                        <RankDelta delta={delta} />
                      </span>
                    </>
                  )}
                  <span className="font-data text-xs text-text-dim">
                    {item.score.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {data && (
          <p className="mt-4 flex items-center gap-1.5 text-xs text-text-dim">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-rise" aria-hidden="true" />
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
    </div>
  );
}
