import { NextRequest, NextResponse } from "next/server";
import { extractKeywordHistory, getRecentTrendSnapshots } from "@/lib/trends/persist";
import { normalizeRegion } from "@/lib/trends/regions";
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

const RATE_LIMIT_PER_MINUTE = 30;
const DEFAULT_SNAPSHOT_LIMIT = 50;

/**
 * GET /api/trends/keyword-history?keyword=X&region=KR&limit=50
 *
 * Returns just one keyword's rank/score points across recent snapshots,
 * oldest first — for a per-keyword detail view. Deliberately not "reuse
 * /api/trends/history as-is": that endpoint returns every keyword's full
 * item list per snapshot, which is wasteful to ship to the browser when
 * the caller only wants one keyword's series. This route still fetches
 * full snapshot rows server-side (getRecentTrendSnapshots, same as the
 * history route — cheap, server-to-server, bounded by `limit`) but
 * filters down to one keyword (extractKeywordHistory) before responding,
 * so the client payload stays small regardless of how many keywords were
 * in each snapshot.
 *
 * `limit` bounds how many recent snapshots to search, not how many points
 * come back — a keyword absent from some snapshots (e.g. it fell out of
 * the top 20) simply contributes fewer points, not an error.
 */
export async function GET(req: NextRequest) {
  const rateLimit = await checkRateLimit(
    "trends-keyword-history",
    getClientIdentifier(req),
    RATE_LIMIT_PER_MINUTE
  );
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const keyword = req.nextUrl.searchParams.get("keyword")?.trim();
  if (!keyword) {
    return NextResponse.json({ error: "keyword is required" }, { status: 400 });
  }

  const region = normalizeRegion(req.nextUrl.searchParams.get("region"));
  const limitParam = req.nextUrl.searchParams.get("limit");
  const limit = limitParam ? Number(limitParam) : DEFAULT_SNAPSHOT_LIMIT;
  const snapshotLimit = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_SNAPSHOT_LIMIT;

  const snapshots = await getRecentTrendSnapshots(region, snapshotLimit);
  const points = extractKeywordHistory(snapshots, keyword);

  return NextResponse.json({ keyword, region, points });
}
