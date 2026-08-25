"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TrendsResponse } from "@/lib/trends/types";
import { fetchTrendsHistory, toHistoryMap, computeDelta, TrendHistoryPoint } from "@/lib/trends/history";
import { fetchKeywordHistory } from "@/lib/trends/keywordHistory";
import { REGIONS, DEFAULT_REGION } from "@/lib/trends/regions";
import { sourceLabel } from "@/lib/trends/sourceLabel";
import {
  fetchWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  acknowledgeWatchlistItem,
  WatchlistRow,
} from "@/lib/watchlist";
import { useAuth } from "@/lib/auth/useAuth";
import { RankDelta } from "@/components/RankDelta";
import { RankSparkline } from "@/components/RankSparkline";
import { AuthHeader } from "@/components/AuthHeader";
import { AuthModal } from "@/components/AuthModal";
import { RegionTabs } from "@/components/RegionTabs";
import { WatchlistPanel } from "@/components/WatchlistPanel";
import { EmptyFlaps } from "@/components/EmptyFlaps";
import { KeywordDetailModal } from "@/components/KeywordDetailModal";

function isValidRegion(code: string | null): code is string {
  return !!code && REGIONS.some((r) => r.code === code);
}

export function HomeClient() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  const [region, setRegion] = useState<string>(() => {
    const fromUrl = searchParams.get("region");
    return isValidRegion(fromUrl) ? fromUrl : DEFAULT_REGION;
  });
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyMap, setHistoryMap] = useState<Map<string, TrendHistoryPoint[]>>(new Map());
  // Bumped on every successful load so the row list remounts and replays the
  // flap-in animation — the board "re-tallies" on refresh, like a real one.
  const [revision, setRevision] = useState(0);

  const auth = useAuth();
  const [authModalOpen, setAuthModalOpen] = useState(false);
  // The URL is the source of truth for the detail modal — deep-linkable,
  // and the browser back/forward buttons genuinely open/close it rather
  // than just visually, since it's derived from the current URL on every
  // render instead of duplicated into separate component state.
  const detailKeyword = searchParams.get("keyword");
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

  // If the detail modal is open and the user switches region tabs, keep the
  // URL's region param in sync so the link stays shareable — via replace
  // (not push) so this doesn't spam the back-button history with every tab
  // switch, unlike the explicit open/close actions below.
  useEffect(() => {
    if (!detailKeyword) return;
    if (searchParams.get("region") === region) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("region", region);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [region, detailKeyword, pathname, router, searchParams]);

  const openDetail = useCallback(
    (keyword: string) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("keyword", keyword);
      params.set("region", region);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, pathname, router, region],
  );

  const closeDetail = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("keyword");
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [searchParams, pathname, router]);

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

  // Opening a watchlist item's detail needs its OWN region, not whatever
  // region tab happens to be active — using the closure's `region` here
  // (via openDetail) would briefly push the wrong region into the URL
  // until the sync effect above corrected it. Build the URL directly with
  // the item's region instead, and switch the active tab to match.
  const viewWatchlistItem = useCallback(
    (keyword: string, itemRegion: string) => {
      setRegion(itemRegion);
      const params = new URLSearchParams(searchParams.toString());
      params.set("keyword", keyword);
      params.set("region", itemRegion);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, pathname, router],
  );

  // Acknowledging is "you actually looked at this keyword" — fires whenever
  // the detail modal is open for a keyword that's on the watchlist for the
  // active region, regardless of how it was opened (watchlist chip or a
  // ranking row). Skipped when there's nothing to acknowledge (already at
  // the current rank, or no rank data yet) to avoid a pointless PATCH on
  // every view — this also prevents the effect from looping once the
  // acknowledged row comes back with last_seen_rank === current_rank.
  useEffect(() => {
    if (!detailKeyword || watchlist === null) return;
    const entry = watchlist.find((w) => w.keyword === detailKeyword && w.region === region);
    if (!entry || entry.current_rank === entry.last_seen_rank) return;
    acknowledgeWatchlistItem(entry.id).then((updated) => {
      if (!updated) return;
      setWatchlist((prev) =>
        prev === null ? prev : prev.map((w) => (w.id === updated.id ? updated : w)),
      );
    });
  }, [detailKeyword, region, watchlist]);

  const isEmpty = !!data && data.items.length === 0;
  const watchlistAvailable = !!auth.user && watchlist !== null;
  // Show a per-item source tag only once it's actually informative — no
  // point stamping "YouTube" on every row while that's the only source.
  // The moment a second source starts flowing, this switches on by itself.
  const hasMultipleSources = !!data && new Set(data.items.map((item) => item.source)).size > 1;

  // Client-side filter over the currently loaded list only — no new API,
  // and deliberately NOT synced to the URL, so it can never interfere with
  // ?keyword= deep-linking (that always opens via a separate fetch keyed
  // by keyword, independent of what's currently visible in the list).
  const [filterQuery, setFilterQuery] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const trimmedQuery = filterQuery.trim().toLowerCase();
  const filteredItems = data
    ? trimmedQuery
      ? data.items.filter((item) => item.keyword.toLowerCase().includes(trimmedQuery))
      : data.items
    : [];
  const hasNoMatches = !!data && !isEmpty && trimmedQuery !== "" && filteredItems.length === 0;

  useEffect(() => {
    // "/" focuses the search box, like GitHub/Slack — but not while a modal's
    // focus trap is active (would yank focus out from under it), and not
    // while the user is already typing somewhere (so "/" still types
    // normally in the auth form, the filter box itself, etc).
    if (authModalOpen || detailKeyword) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "/") return;
      const target = e.target as HTMLElement;
      const isTyping =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
      if (isTyping) return;
      e.preventDefault();
      filterInputRef.current?.focus();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [authModalOpen, detailKeyword]);

  return (
    <div className="min-h-screen bg-casing text-flap">
      <header className="border-b border-flap-dim/20 bg-panel">
        <div className="mx-auto max-w-2xl px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-4">
              <span className="font-display text-xl tracking-wide text-flap">FLIP</span>
              <RegionTabs regions={REGIONS} active={region} onChange={setRegion} />
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => load(region)}
                disabled={loading}
                className="rounded-sm border border-flap-dim/20 px-3 py-1.5 font-data text-xs text-flap-dim transition hover:border-flap-dim/40 hover:text-flap disabled:opacity-50"
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
          <h1 className="mt-2 font-body text-xs font-normal text-flap-dim">
            인기 급상승 신호를 실시간으로 감지하는 키워드 보드
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-6">
        {data && !isEmpty && (
          <div className="mb-4">
            <label
              htmlFor="keyword-filter"
              className="mb-1.5 block font-data text-[11px] uppercase tracking-widest text-flap-dim"
            >
              검색 <span className="normal-case tracking-normal text-flap-dim/60">(/)</span>
            </label>
            <div className="flex items-center gap-2 border-b border-flap-dim/25 focus-within:border-flap">
              <input
                id="keyword-filter"
                ref={filterInputRef}
                type="text"
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
                placeholder="키워드로 필터링"
                className="w-full border-0 bg-transparent py-1.5 font-data text-sm text-flap outline-none placeholder:text-flap-dim/50"
              />
              {filterQuery && (
                <button
                  onClick={() => setFilterQuery("")}
                  aria-label="검색어 지우기"
                  className="shrink-0 text-flap-dim hover:text-flap"
                >
                  ✕
                </button>
              )}
            </div>
            <p aria-live="polite" className="mt-1 font-data text-[10px] text-flap-dim">
              {trimmedQuery && `${filteredItems.length}개 결과`}
            </p>
          </div>
        )}

        {data?.mocked && (
          <div className="mb-4 rounded-sm border border-flap-dim/25 bg-panel px-3 py-2 text-sm text-flap-dim">
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
              <div key={i} className="h-11 animate-pulse rounded-sm bg-panel" />
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-3 rounded-sm border border-dashed border-flap-dim/25 px-4 py-14 text-center">
            <EmptyFlaps />
            <p className="text-sm font-medium text-flap">표시할 키워드가 없습니다</p>
            <p className="text-xs text-flap-dim">잠시 후 다시 갱신해보세요.</p>
            <button
              onClick={() => load(region)}
              className="mt-2 rounded-sm border border-flap-dim/20 px-3 py-1.5 text-xs text-flap-dim hover:border-flap-dim/40 hover:text-flap"
            >
              갱신
            </button>
          </div>
        )}

        {watchlistAvailable && (
          <WatchlistPanel
            entries={watchlist ?? []}
            onRemove={removeWatchlistEntry}
            onView={viewWatchlistItem}
          />
        )}

        {hasNoMatches && (
          <div className="flex flex-col items-center gap-3 rounded-sm border border-dashed border-flap-dim/25 px-4 py-14 text-center">
            <EmptyFlaps />
            <p className="text-sm font-medium text-flap">
              &lsquo;{filterQuery.trim()}&rsquo;에 대한 결과가 없습니다
            </p>
            <p className="text-xs text-flap-dim">다른 키워드로 검색해보세요.</p>
            <button
              onClick={() => setFilterQuery("")}
              className="mt-2 rounded-sm border border-flap-dim/20 px-3 py-1.5 text-xs text-flap-dim hover:border-flap-dim/40 hover:text-flap"
            >
              전체 목록 보기
            </button>
          </div>
        )}

        {data && !isEmpty && !hasNoMatches && (
          <ol key={revision} className="flex flex-col gap-1">
            {filteredItems.map((item, i) => {
              const history = historyMap.get(item.keyword);
              const delta = computeDelta(history);
              const isWatched =
                watchlistAvailable &&
                (watchlist ?? []).some((w) => w.keyword === item.keyword && w.region === region);
              return (
                <li
                  key={item.rank}
                  className="flap-row flex items-center gap-3 rounded-sm border border-flap-dim/10 bg-panel px-3 py-2.5 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_2px_4px_rgba(0,0,0,0.35)]"
                  style={{ animationDelay: `${Math.min(i, 20) * 30}ms` }}
                >
                  <span className="w-6 text-right font-data text-base font-bold text-flap-dim">
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
                      className={`shrink-0 -m-1 p-1 text-base leading-none ${isWatched ? "text-flap" : "text-flap-dim/50 hover:text-flap"}`}
                    >
                      {isWatched ? "★" : "☆"}
                    </button>
                  )}
                  <button
                    onClick={() => openDetail(item.keyword)}
                    className="min-w-0 flex-1 truncate py-1 text-left font-data text-sm text-flap hover:text-flap/80"
                  >
                    {item.keyword}
                  </button>
                  {hasMultipleSources && (
                    <span className="shrink-0 rounded-sm border border-flap-dim/20 px-1.5 py-0.5 font-data text-[10px] uppercase tracking-wide text-flap-dim">
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
                  <span className="font-data text-xs text-flap-dim">
                    {item.score.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {data && (
          <p className="mt-4 flex items-center gap-1.5 font-data text-[11px] text-flap-dim">
            <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-rising" aria-hidden="true" />
            마지막 갱신: {new Date(data.fetchedAt).toLocaleString()}
          </p>
        )}
      </main>

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
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
