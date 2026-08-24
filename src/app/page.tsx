"use client";

import { useCallback, useEffect, useState } from "react";
import { TrendsResponse } from "@/lib/trends/types";
import { fetchTrendsHistory, toHistoryMap, computeDelta, TrendHistoryPoint } from "@/lib/trends/history";
import { RankDelta } from "@/components/RankDelta";
import { RankSparkline } from "@/components/RankSparkline";

export default function Home() {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [historyMap, setHistoryMap] = useState<Map<string, TrendHistoryPoint[]>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trends?region=KR");
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
    const history = await fetchTrendsHistory("KR");
    setHistoryMap(toHistoryMap(history));
  }, []);

  useEffect(() => {
    // Initial data fetch on mount — an explicitly valid effect use case per React docs.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const isEmpty = !!data && data.items.length === 0;

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-6 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold">실시간 인기 키워드 랭킹</h1>
            <p className="text-sm text-neutral-400 mt-1">
              YouTube 인기 급상승 기준 · 지역: {data?.region ?? "KR"}
            </p>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>

        {data?.mocked && (
          <div className="mb-4 rounded-md border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-sm text-amber-300">
            목업 데이터 표시 중입니다. YOUTUBE_API_KEY를 설정하면 실제 데이터로 전환됩니다.
          </div>
        )}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-md border border-red-700/50 bg-red-950/30 px-3 py-2 text-sm text-red-300"
          >
            오류: {error}
          </div>
        )}

        {loading && !data && (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-neutral-900" />
            ))}
          </div>
        )}

        {isEmpty && (
          <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-neutral-800 px-4 py-14 text-center">
            <span className="text-3xl">🔍</span>
            <p className="text-sm font-medium text-neutral-300">표시할 랭킹 데이터가 없습니다</p>
            <p className="text-xs text-neutral-500">
              잠시 후 다시 시도하거나 새로고침 버튼을 눌러주세요.
            </p>
            <button
              onClick={load}
              className="mt-2 rounded-md bg-neutral-800 px-3 py-1.5 text-xs hover:bg-neutral-700"
            >
              다시 시도
            </button>
          </div>
        )}

        {data && !isEmpty && (
          <ol className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
            {data.items.map((item) => {
              const history = historyMap.get(item.keyword);
              const delta = computeDelta(history);
              return (
                <li key={item.rank} className="flex items-center gap-4 px-4 py-3">
                  <span className="w-6 text-right text-sm font-medium text-neutral-500">
                    {item.rank}
                  </span>
                  <span className="flex-1 text-sm">{item.keyword}</span>
                  {historyMap.size > 0 && (
                    <>
                      {history && <RankSparkline history={history} />}
                      <span className="w-9 text-right">
                        <RankDelta delta={delta} />
                      </span>
                    </>
                  )}
                  <span className="text-xs text-neutral-500">
                    {item.score.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {data && (
          <p className="mt-4 text-xs text-neutral-600">
            마지막 갱신: {new Date(data.fetchedAt).toLocaleString()}
          </p>
        )}
      </div>
    </div>
  );
}
