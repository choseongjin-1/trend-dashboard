import { NextRequest, NextResponse } from "next/server";
import { getSupabaseRouteHandlerClient } from "@/lib/supabase/server";
import { normalizeRegion } from "@/lib/trends/regions";

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

/** GET /api/watchlist — list the signed-in user's watchlist items. */
export async function GET() {
  const { supabase, user } = await requireSession();
  if (!supabase || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("watchlist")
    .select("id, keyword, region, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("GET /api/watchlist: query failed", error);
    return NextResponse.json({ error: "query_failed" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
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
    .select("id, keyword, region, created_at")
    .single();

  if (error) {
    console.error("POST /api/watchlist: insert failed", error);
    return NextResponse.json({ error: "insert_failed" }, { status: 500 });
  }

  return NextResponse.json(data, { status: 201 });
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
