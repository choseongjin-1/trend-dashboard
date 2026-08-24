import { getSupabaseServerClient } from "@/lib/supabase/server";
import { TrendsResponse } from "./types";

const TABLE = "trend_snapshots";

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
      source: snapshot.source,
      region: snapshot.region,
      fetched_at: snapshot.fetchedAt,
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
      .select("id, source, region, fetched_at, items, created_at")
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
