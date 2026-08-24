// Frontend-side type & fetch helper for GET /api/trends/history.
//
// That route is being built concurrently by a separate (backend) agent in a
// different git worktree. At the time this file was written it did NOT exist
// in this worktree, and its exact response shape is not guaranteed. Every
// consumer of this module MUST treat a 404, a network error, or a
// malformed/unexpected response body as "no history available" — never as an
// error to surface to the user. This is a best-effort enhancement layered on
// top of the core `/api/trends` contract, not a required dependency.
//
// Expected (assumed) shape, mirroring the naming conventions of
// `src/lib/trends/types.ts`:
//
//   {
//     region: string,
//     items: [
//       { keyword: string, history: [{ rank: number, fetchedAt: string }, ...] },
//       ...
//     ]
//   }

export interface TrendHistoryPoint {
  rank: number;
  fetchedAt: string;
}

export interface TrendHistoryItem {
  keyword: string;
  history: TrendHistoryPoint[];
}

export interface TrendsHistoryResponse {
  region: string;
  items: TrendHistoryItem[];
}

function isTrendHistoryPoint(value: unknown): value is TrendHistoryPoint {
  if (typeof value !== "object" || value === null) return false;
  const point = value as Record<string, unknown>;
  return typeof point.rank === "number" && typeof point.fetchedAt === "string";
}

function isTrendHistoryItem(value: unknown): value is TrendHistoryItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.keyword === "string" &&
    Array.isArray(item.history) &&
    item.history.every(isTrendHistoryPoint)
  );
}

export function isTrendsHistoryResponse(value: unknown): value is TrendsHistoryResponse {
  if (typeof value !== "object" || value === null) return false;
  const response = value as Record<string, unknown>;
  return (
    typeof response.region === "string" &&
    Array.isArray(response.items) &&
    response.items.every(isTrendHistoryItem)
  );
}

/**
 * Fetches keyword rank history for a region.
 *
 * Returns `null` on ANY failure — network error, non-2xx status, invalid
 * JSON, or a body that doesn't match the expected shape — so callers can
 * simply hide history UI rather than surface an error. Never throws.
 */
export async function fetchTrendsHistory(
  region: string,
  signal?: AbortSignal,
): Promise<TrendsHistoryResponse | null> {
  try {
    const res = await fetch(`/api/trends/history?region=${encodeURIComponent(region)}`, {
      signal,
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isTrendsHistoryResponse(json)) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Builds a keyword -> history lookup for quick access while rendering rows.
 */
export function toHistoryMap(
  response: TrendsHistoryResponse | null,
): Map<string, TrendHistoryPoint[]> {
  const map = new Map<string, TrendHistoryPoint[]>();
  if (!response) return map;
  for (const item of response.items) {
    if (item.history.length > 0) {
      map.set(
        item.keyword,
        [...item.history].sort(
          (a, b) => new Date(a.fetchedAt).getTime() - new Date(b.fetchedAt).getTime(),
        ),
      );
    }
  }
  return map;
}

/**
 * Delta between the two most recent points: previous rank - current rank.
 * Positive means the keyword improved (moved to a lower/better rank number).
 * Returns null when there isn't enough history to compute a delta.
 */
export function computeDelta(history: TrendHistoryPoint[] | undefined): number | null {
  if (!history || history.length < 2) return null;
  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  return previous.rank - current.rank;
}
