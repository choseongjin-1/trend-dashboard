// Frontend-side type & fetch helper for GET /api/trends/history.
//
// Backed by the real backend route (src/app/api/trends/history/route.ts +
// src/lib/trends/persist.ts on the backend track), which always resolves
// HTTP 200 with a plain JSON array of snapshot rows — `[]` when Supabase
// isn't configured or no history exists yet, never an error status for that
// case. Every consumer of this module MUST still treat a non-2xx status, a
// network error, or a malformed/unexpected response body as "no history
// available" — never as an error to surface to the user. This remains a
// best-effort enhancement layered on top of the core `/api/trends` contract,
// not a required dependency.
//
// Real response shape:
//
//   TrendSnapshotRow[] // newest first from the API, order not relied upon here
//
//   interface TrendSnapshotRow {
//     id: string;
//     source: string;
//     region: string;
//     fetched_at: string;
//     items: TrendItem[]; // same shape as /api/trends's TrendsResponse["items"]
//     created_at: string;
//   }

import { TrendItem } from "./types";

export interface TrendHistoryPoint {
  rank: number;
  fetchedAt: string;
}

export interface TrendSnapshotRow {
  id: string;
  source: string;
  region: string;
  fetched_at: string;
  items: TrendItem[];
  created_at: string;
}

export type TrendsHistoryResponse = TrendSnapshotRow[];

function isTrendItem(value: unknown): value is TrendItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.rank === "number" &&
    typeof item.keyword === "string" &&
    typeof item.source === "string" &&
    typeof item.score === "number"
  );
}

function isTrendSnapshotRow(value: unknown): value is TrendSnapshotRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.source === "string" &&
    typeof row.region === "string" &&
    typeof row.fetched_at === "string" &&
    typeof row.created_at === "string" &&
    Array.isArray(row.items) &&
    row.items.every(isTrendItem)
  );
}

/**
 * `[]` (zero snapshots) satisfies this vacuously and is a valid response,
 * not a parse failure — distinct from a non-array body, which fails.
 */
export function isTrendsHistoryResponse(value: unknown): value is TrendsHistoryResponse {
  return Array.isArray(value) && value.every(isTrendSnapshotRow);
}

/**
 * Fetches recent trend snapshots for a region.
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
 * Builds a keyword -> rank history lookup (oldest to newest point) from raw
 * snapshots, for quick access while rendering rows. A keyword's points come
 * only from the snapshots it actually appears in, so a keyword missing from
 * an older snapshot simply has fewer points rather than a gap entry.
 */
export function toHistoryMap(
  response: TrendsHistoryResponse | null,
): Map<string, TrendHistoryPoint[]> {
  const map = new Map<string, TrendHistoryPoint[]>();
  if (!response) return map;

  const snapshots = [...response].sort(
    (a, b) => new Date(a.fetched_at).getTime() - new Date(b.fetched_at).getTime(),
  );

  for (const snapshot of snapshots) {
    for (const item of snapshot.items) {
      const point: TrendHistoryPoint = { rank: item.rank, fetchedAt: snapshot.fetched_at };
      const points = map.get(item.keyword);
      if (points) {
        points.push(point);
      } else {
        map.set(item.keyword, [point]);
      }
    }
  }

  return map;
}

/**
 * Delta between the two most recent points: previous rank - current rank.
 * Positive means the keyword improved (moved to a lower/better rank number).
 * Returns null when there isn't enough history to compute a delta (e.g.
 * fewer than 2 snapshots exist yet) — treated the same as "no history" by
 * callers, not as an error.
 */
export function computeDelta(history: TrendHistoryPoint[] | undefined): number | null {
  if (!history || history.length < 2) return null;
  const current = history[history.length - 1];
  const previous = history[history.length - 2];
  return previous.rank - current.rank;
}
