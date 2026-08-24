import { NextRequest, NextResponse } from "next/server";
import { getRecentTrendSnapshots } from "@/lib/trends/persist";
import { normalizeRegion } from "@/lib/trends/regions";

/**
 * GET /api/trends/history?region=KR&limit=20
 *
 * Returns the most recent trend snapshots for a region, newest first, as a
 * plain JSON array. Always resolves with HTTP 200 — when Supabase is not
 * configured (or the query fails), getRecentTrendSnapshots() returns an
 * empty array rather than throwing, so this route degrades to `[]` instead
 * of surfacing an error to the client.
 */
export async function GET(req: NextRequest) {
  const region = normalizeRegion(req.nextUrl.searchParams.get("region"));
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : 20;

  const snapshots = await getRecentTrendSnapshots(
    region,
    Number.isFinite(limit) && limit > 0 ? limit : 20
  );

  return NextResponse.json(snapshots);
}
