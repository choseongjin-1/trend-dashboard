import { getSupabaseServerClient } from "@/lib/supabase/server";
import { TrendSource, TrendsResponse } from "./types";

/**
 * The `source` column predates multi-source blending and is `text not
 * null` — rather than a migration to widen it, a snapshot's sources are
 * stored as a comma-joined string (e.g. "youtube,hackernews") and parsed
 * back on read. An old single-source row ("youtube") round-trips fine:
 * splitting on "," with no comma present just yields a one-element array.
 */
export function serializeSources(sources: TrendSource[]): string {
  return sources.join(",");
}

export function parseSources(value: string): TrendSource[] {
  return value.split(",").filter(Boolean) as TrendSource[];
}

const TABLE = "trend_snapshots";

/** How long a stored snapshot is considered fresh enough to serve without hitting YouTube again. */
export const FRESHNESS_WINDOW_MS = 15 * 60 * 1000;

/**
 * Persists a trend snapshot to Supabase (`trend_snapshots` table).
 *
 * Safe no-op when Supabase credentials are not configured
 * (getSupabaseServerClient() returns null) — resolves without throwing.
 * Never throws on a Supabase-side error either; callers (e.g. the
 * /api/trends route) must be able to fire-and-forget this without risking
 * the HTTP response.
 */
export async function saveTrendSnapshot(snapshot: TrendsResponse): Promise<void> {
  const client = getSupabaseServerClient();
  if (!client) {
    return;
  }

  try {
    const { error } = await client.from(TABLE).insert({
      source: serializeSources(snapshot.sources),
      region: snapshot.region,
      fetched_at: snapshot.fetchedAt,
      mocked: snapshot.mocked,
      items: snapshot.items,
    });

    if (error) {
      console.error("saveTrendSnapshot: insert failed", error);
    }
  } catch (err) {
    console.error("saveTrendSnapshot: unexpected error", err);
  }
}

export interface TrendSnapshotRow {
  id: string;
  source: string;
  region: string;
  fetched_at: string;
  mocked: boolean;
  items: TrendsResponse["items"];
  created_at: string;
}

/**
 * Fetches the most recent trend snapshots for a region, newest first.
 *
 * Safe no-op when Supabase is unavailable or the query fails — returns an
 * empty array rather than throwing, so callers (e.g. the history API
 * route) can always respond with HTTP 200.
 */
export async function getRecentTrendSnapshots(
  region: string,
  limit = 20
): Promise<TrendSnapshotRow[]> {
  const client = getSupabaseServerClient();
  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from(TABLE)
      .select("id, source, region, fetched_at, mocked, items, created_at")
      .eq("region", region)
      .order("fetched_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("getRecentTrendSnapshots: query failed", error);
      return [];
    }

    return (data ?? []) as TrendSnapshotRow[];
  } catch (err) {
    console.error("getRecentTrendSnapshots: unexpected error", err);
    return [];
  }
}

/**
 * Pure freshness check, factored out so it's unit-testable without a
 * Supabase client: is `fetchedAt` within `maxAgeMs` of `now`?
 */
export function isSnapshotFresh(fetchedAt: string, maxAgeMs: number, now: Date = new Date()): boolean {
  const fetchedAtMs = new Date(fetchedAt).getTime();
  if (Number.isNaN(fetchedAtMs)) return false;
  return now.getTime() - fetchedAtMs <= maxAgeMs;
}

/**
 * Returns the newest stored snapshot for a region if it's still within the
 * freshness window, or null if there's no snapshot, it's stale, or
 * Supabase isn't configured/reachable. Callers use this to decide whether
 * a live YouTube call is needed at all.
 */
export async function getFreshTrendSnapshot(
  region: string,
  maxAgeMs: number = FRESHNESS_WINDOW_MS
): Promise<TrendSnapshotRow | null> {
  const [latest] = await getRecentTrendSnapshots(region, 1);
  if (!latest) return null;
  return isSnapshotFresh(latest.fetched_at, maxAgeMs) ? latest : null;
}

export interface KeywordHistoryPoint {
  fetchedAt: string;
  rank: number;
  score: number;
}

/**
 * Pure extraction, factored out for unit testing without a Supabase
 * client: pulls one keyword's rank/score out of each snapshot's full item
 * list, oldest first. Snapshots that don't contain the keyword are simply
 * skipped (that keyword wasn't in that snapshot's ranking) rather than
 * treated as an error.
 *
 * This exists as its own step — rather than the keyword-history route
 * being a thin filter over /api/trends/history's full snapshot rows — so
 * that route can fetch snapshots once and hand back a payload containing
 * only this one keyword's points, not every keyword's full item list.
 */
export function extractKeywordHistory(
  snapshots: TrendSnapshotRow[],
  keyword: string
): KeywordHistoryPoint[] {
  return snapshots
    .map((snapshot): KeywordHistoryPoint | null => {
      const item = snapshot.items.find((i) => i.keyword === keyword);
      return item ? { fetchedAt: snapshot.fetched_at, rank: item.rank, score: item.score } : null;
    })
    .filter((point): point is KeywordHistoryPoint => point !== null)
    .sort((a, b) => a.fetchedAt.localeCompare(b.fetchedAt));
}

/**
 * Pure lookup, factored out for unit testing without a Supabase client:
 * finds a keyword's rank in a single snapshot (typically the latest one
 * for a region), or null if there's no snapshot at all or the keyword
 * isn't in it. "Not in it" is a normal outcome (the keyword fell out of
 * the rankings), not an error — callers (the watchlist route) must treat
 * null as "no current rank," never surface it as a failure.
 */
export function findCurrentRank(snapshot: TrendSnapshotRow | null, keyword: string): number | null {
  if (!snapshot) return null;
  const item = snapshot.items.find((i) => i.keyword === keyword);
  return item ? item.rank : null;
}

/** Converts a stored snapshot row back into the public TrendsResponse shape. */
export function snapshotRowToResponse(row: TrendSnapshotRow): TrendsResponse {
  return {
    sources: parseSources(row.source),
    region: row.region,
    fetchedAt: row.fetched_at,
    mocked: row.mocked,
    items: row.items,
  };
}
