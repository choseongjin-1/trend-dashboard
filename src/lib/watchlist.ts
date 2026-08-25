// Frontend-side client for /api/watchlist, matching the real backend route
// (src/app/api/watchlist/route.ts on backend-loop).
//
// Session-aware — a logged-out caller gets 401, which this module treats the
// same as any other failure: "unavailable", never thrown. Every function
// here follows the same discipline as src/lib/trends/history.ts — a non-2xx
// status, a network error, or a malformed body all resolve to a sentinel
// (`null`/`false`) so callers hide/disable watchlist UI instead of crashing
// or surfacing a page error.
//
// Real contract (reconciled against src/app/api/watchlist/route.ts after
// the backend added last-seen-rank tracking):
//   GET    /api/watchlist            -> 200: WatchlistRow[]; 401 when signed out
//   POST   /api/watchlist  {keyword, region?} -> 201 with the created row
//          (last_seen_rank/last_seen_at are null on a fresh row; the POST
//          response does NOT include current_rank at all — the route's
//          insert `.select()` doesn't compute it, unlike GET/PATCH)
//   PATCH  /api/watchlist  {id}      -> 200: acknowledges current_rank as
//          the new last_seen_rank baseline, returns the updated row
//   DELETE /api/watchlist?id=<uuid>  -> 200: { ok: true }

export interface WatchlistRow {
  id: string;
  keyword: string;
  region: string;
  created_at: string;
  /** Rank baseline as of the last acknowledge (PATCH); null until acknowledged once. */
  last_seen_rank: number | null;
  last_seen_at: string | null;
  /**
   * Rank as of the latest snapshot; null when the keyword isn't currently
   * ranked at all (fell out of the rankings) — a real state, not "unknown".
   * Absent entirely on POST's response (see above), so this is optional.
   */
  current_rank?: number | null;
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isWatchlistRow(value: unknown): value is WatchlistRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.keyword === "string" &&
    typeof row.region === "string" &&
    typeof row.created_at === "string" &&
    isNullableNumber(row.last_seen_rank) &&
    isNullableString(row.last_seen_at) &&
    (row.current_rank === undefined || isNullableNumber(row.current_rank))
  );
}

function isWatchlistRows(value: unknown): value is WatchlistRow[] {
  return Array.isArray(value) && value.every(isWatchlistRow);
}

/**
 * Fetches the current user's watchlist. Returns `null` on any failure
 * (including "not logged in" / a malformed body) so callers hide the
 * feature rather than show a broken one.
 */
export async function fetchWatchlist(signal?: AbortSignal): Promise<WatchlistRow[] | null> {
  try {
    const res = await fetch("/api/watchlist", { signal, credentials: "same-origin" });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isWatchlistRows(json)) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Adds a keyword (for the given region) to the watchlist. Returns the
 * created row on success, or `null` on any failure — caller should leave
 * local state unchanged (no optimistic update survives).
 */
export async function addToWatchlist(keyword: string, region: string): Promise<WatchlistRow | null> {
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ keyword, region }),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isWatchlistRow(json)) return null;
    return json;
  } catch {
    return null;
  }
}

/**
 * Removes a watchlist entry by its row id. Returns `false` on any failure.
 */
export async function removeFromWatchlist(id: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/watchlist?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
      credentials: "same-origin",
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Acknowledges a watchlist item's current rank as the new last-seen
 * baseline — call when the user actually views that keyword (e.g. opens
 * its detail view). Returns the updated row (with `last_seen_rank` now
 * equal to `current_rank`) on success, or `null` on any failure — caller
 * should leave the existing "moved" indicator as-is rather than clear it
 * optimistically.
 */
export async function acknowledgeWatchlistItem(id: string): Promise<WatchlistRow | null> {
  try {
    const res = await fetch("/api/watchlist", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ id }),
    });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isWatchlistRow(json)) return null;
    return json;
  } catch {
    return null;
  }
}

export type WatchlistRankChange =
  | { kind: "unknown" } // no current-rank data at all yet (e.g. the row just came back from POST, which doesn't include it — distinct from a confirmed "not ranked")
  | { kind: "new" } // ranked now, but never acknowledged — no baseline to compare against yet
  | { kind: "dropped" } // confirmed not in the current rankings (current_rank is explicitly null)
  | { kind: "unchanged"; rank: number }
  | { kind: "moved"; from: number; to: number };

/**
 * Classifies a watchlist row's rank movement since it was last acknowledged.
 * Pure and easily testable — the actual "moved" badge is just a rendering
 * of this result, kept separate so the null/undefined-combination logic
 * isn't buried in JSX.
 */
export function describeRankChange(row: Pick<WatchlistRow, "current_rank" | "last_seen_rank">): WatchlistRankChange {
  if (row.current_rank === undefined) return { kind: "unknown" };
  if (row.current_rank === null) return { kind: "dropped" };
  if (row.last_seen_rank === null) return { kind: "new" };
  if (row.current_rank === row.last_seen_rank) return { kind: "unchanged", rank: row.current_rank };
  return { kind: "moved", from: row.last_seen_rank, to: row.current_rank };
}
