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
// Real contract:
//   GET    /api/watchlist            -> 200: WatchlistRow[]; 401 when signed out
//   POST   /api/watchlist  {keyword, region?} -> 201 with the created row
//   DELETE /api/watchlist?id=<uuid>  -> 200: { ok: true }

export interface WatchlistRow {
  id: string;
  keyword: string;
  region: string;
  created_at: string;
}

function isWatchlistRow(value: unknown): value is WatchlistRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.keyword === "string" &&
    typeof row.region === "string" &&
    typeof row.created_at === "string"
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
