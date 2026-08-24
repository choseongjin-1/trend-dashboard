// Frontend-side client for GET /api/trends/keyword-history — a dedicated,
// smaller-payload endpoint for a single keyword's rank history, used by
// KeywordDetailModal instead of re-slicing the region-wide /api/trends/history
// response. Same defensive discipline as history.ts/watchlist.ts: a non-2xx
// status (including a 429 rate limit), a network error, or a malformed body
// all resolve to `null` so the modal falls back to its "not enough data"
// state rather than crashing.

import type { TrendHistoryPoint } from "./history";

interface KeywordHistoryResponse {
  keyword: string;
  region: string;
  points: TrendHistoryPoint[];
}

function isTrendHistoryPoint(value: unknown): value is TrendHistoryPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return typeof point.rank === "number" && typeof point.fetchedAt === "string";
}

function isKeywordHistoryResponse(value: unknown): value is KeywordHistoryResponse {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.keyword === "string" &&
    typeof body.region === "string" &&
    Array.isArray(body.points) &&
    body.points.every(isTrendHistoryPoint)
  );
}

export async function fetchKeywordHistory(
  keyword: string,
  region: string,
  signal?: AbortSignal,
): Promise<TrendHistoryPoint[] | null> {
  try {
    const res = await fetch(
      `/api/trends/keyword-history?keyword=${encodeURIComponent(keyword)}&region=${encodeURIComponent(region)}`,
      { signal },
    );
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isKeywordHistoryResponse(json)) return null;
    return json.points;
  } catch {
    return null;
  }
}
