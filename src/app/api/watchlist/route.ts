import { NextRequest, NextResponse } from "next/server";
import { getSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { normalizeRegion } from "@/lib/trends/regions";
import { findCurrentRank, getRecentTrendSnapshots, TrendSnapshotRow } from "@/lib/trends/persist";

/**
 * Resolves the session-aware client + current user together, since every
 * handler below needs both and must 401 the same way when either is
 * missing (Supabase unconfigured, or no signed-in session).
 */
async function requireSession() {
  const supabase = await getSupabaseRouteHandlerClient();
  if (!supabase) {
    return { supabase: null, user: null } as const;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return { supabase, user: null } as const;
  }
  return { supabase, user: data.user } as const;
}

/**
 * Fetches the latest snapshot for each distinct region among `regions`,
 * once per region rather than once per watchlist item — a user can watch
 * several keywords in the same region, and this avoids N redundant
 * snapshot queries for N watchlist items.
 */
async function latestSnapshotsByRegion(regions: string[]): Promise<Map<string, TrendSnapshotRow | null>> {
  const distinctRegions = [...new Set(regions)];
  const byRegion = new Map<string, TrendSnapshotRow | null>();
  await Promise.all(
    distinctRegions.map(async (region) => {
      const [latest] = await getRecentTrendSnapshots(region, 1);
      byRegion.set(region, latest ?? null);
    })
  );
  return byRegion;
}

/**
 * GET /api/watchlist — list the signed-in user's watchlist items, each
 * with its stored `last_seen_rank`/`last_seen_at` baseline plus a freshly
 * computed `current_rank` (null if the keyword isn't in the latest
 * snapshot for its region — "not currently ranked," not an error). This
 * is read-only: viewing the list never updates last_seen_rank itself —
 * see PATCH for the explicit acknowledge action.
 */
export async function GET() {
  const { supabase, user } = await requireSession();
  if (!supabase || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .select("id, keyword, region, created_at, last_seen_rank, last_seen_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET /api/watchlist: query failed", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  const rows = data ?? [];
  const snapshotsByRegion = await latestSnapshotsByRegion(rows.map((row) => row.region));

  const withCurrentRank = rows.map((row) => ({
    ...row,
    current_rank: findCurrentRank(snapshotsByRegion.get(row.region) ?? null, row.keyword),
  }));

  return NextResponse.json(withCurrentRank);
}

/** POST /api/watchlist — add a keyword to the signed-in user's watchlist. */
export async function POST(req: NextRequest) {
  const { supabase, user } = await requireSession();
  if (!supabase || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const keyword = typeof body?.keyword === "string" ? body.keyword.trim() : "";
  if (!keyword) {
    return NextResponse.json({ error: "keyword is required" }, { status: 400 });
  }
  const region = normalizeRegion(body?.region);

  const { data, error } = await supabase
    .from("watchlist")
    .insert({ user_id: user.id, keyword, region })
    .select("id, keyword, region, created_at, last_seen_rank, last_seen_at")
    .single();

  if (error) {
    console.error("POST /api/watchlist: insert failed", error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
}

/**
 * PATCH /api/watchlist { id } — acknowledges the keyword's current rank
 * as the new last-seen baseline (e.g. called when the user opens that
 * keyword's detail view). Looks up the current rank itself server-side
 * rather than trusting a client-supplied value, so the baseline can't
 * drift from what the backend actually knows. `last_seen_rank` is set to
 * `null` when the keyword currently has no rank (fell out of the
 * rankings) — that's a real, distinct baseline, not a failed lookup.
 */
export async function PATCH(req: NextRequest) {
  const { supabase, user } = await requireSession();
  if (!supabase || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // RLS scopes this to the caller's own rows; a foreign or nonexistent id
  // just matches nothing here rather than leaking whether it exists.
  const { data: existing, error: fetchError } = await supabase
    .from("watchlist")
    .select("id, keyword, region")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) {
    console.error("PATCH /api/watchlist: lookup failed", fetchError);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [latest] = await getRecentTrendSnapshots(existing.region, 1);
  const currentRank = findCurrentRank(latest ?? null, existing.keyword);
  const lastSeenAt = new Date().toISOString();

  const { data, error } = await supabase
    .from("watchlist")
    .update({ last_seen_rank: currentRank, last_seen_at: lastSeenAt })
    .eq("id", id)
    .select("id, keyword, region, created_at, last_seen_rank, last_seen_at")
    .single();

  if (error) {
    console.error("PATCH /api/watchlist: update failed", error);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  return NextResponse.json({ ...data, current_rank: currentRank });
}

/** DELETE /api/watchlist?id=<uuid> — remove one of the user's own items. */
export async function DELETE(req: NextRequest) {
  const { supabase, user } = await requireSession();
  if (!supabase || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }

  // RLS (`using (auth.uid() = user_id)`) makes this a no-op rather than an
  // error if `id` belongs to another user, so this never leaks whether a
  // given id exists.
  const { error } = await supabase.from("watchlist").delete().eq("id", id);

  if (error) {
    console.error("DELETE /api/watchlist: delete failed", error);
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
