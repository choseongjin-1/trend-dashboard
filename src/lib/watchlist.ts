// Frontend-side client for /api/watchlist.
//
// That route is owned by the backend track this round and may not exist yet
// in this worktree — it's expected to be session-aware (reads the caller's
// Supabase session) and back a `watchlist` table. Its exact response shape
// isn't guaranteed either, so — same discipline as src/lib/trends/history.ts
// — every function here treats a non-2xx status, a network error, or a
// malformed body as "unavailable" and returns a sentinel instead of
// throwing. Callers must hide/disable watchlist UI on that sentinel, never
// crash or surface it as a page error.
//
// Assumed contract (reconcile once the backend route lands, if different):
//   GET    /api/watchlist              -> { keywords: string[] }
//   POST   /api/watchlist   {keyword}  -> 2xx on success
//   DELETE /api/watchlist   {keyword}  -> 2xx on success

function isWatchlistResponse(value: unknown): value is { keywords: string[] } {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.keywords) && body.keywords.every((k) => typeof k === "string");
}

/**
 * Fetches the current user's watchlist. Returns `null` on any failure
 * (including "not logged in" / route missing) so callers hide the feature
 * rather than show a broken one.
 */
export async function fetchWatchlist(signal?: AbortSignal): Promise<string[] | null> {
  try {
    const res = await fetch("/api/watchlist", { signal, credentials: "same-origin" });
    if (!res.ok) return null;
    const json: unknown = await res.json();
    if (!isWatchlistResponse(json)) return null;
    return json.keywords;
  } catch {
    return null;
  }
}

/**
 * Adds a keyword to the watchlist. Returns `false` on any failure — caller
 * should leave local state unchanged (no optimistic update survives).
 */
export async function addToWatchlist(keyword: string): Promise<boolean> {
  try {
    const res = await fetch("/api/watchlist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ keyword }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Removes a keyword from the watchlist. Returns `false` on any failure.
 */
export async function removeFromWatchlist(keyword: string): Promise<boolean> {
  try {
    const res = await fetch("/api/watchlist", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ keyword }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
