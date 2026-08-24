import { NextRequest, NextResponse } from "next/server";
import { fetchYoutubeTrends } from "@/lib/trends/youtube";
import { getMockTrends } from "@/lib/trends/mock";
import { saveTrendSnapshot } from "@/lib/trends/persist";
import { SUPPORTED_REGIONS } from "@/lib/trends/regions";

/**
 * Auth convention: this route is meant to be invoked by a scheduler
 * (e.g. Vercel Cron), never by a browser. It's authorized by a shared
 * secret in `CRON_SECRET`, accepted two ways:
 *  - `Authorization: Bearer <CRON_SECRET>` — the header Vercel Cron sends
 *    automatically when CRON_SECRET is set in the project's env.
 *  - `?secret=<CRON_SECRET>` query param — for manual/local curl testing.
 * If CRON_SECRET isn't configured at all, the route fails closed (401)
 * rather than running unauthenticated.
 */
function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;

  const authHeader = req.headers.get("authorization");
  if (authHeader === `Bearer ${expected}`) return true;

  const queryParam = req.nextUrl.searchParams.get("secret");
  return queryParam === expected;
}

interface RegionResult {
  region: string;
  mocked: boolean;
  items: number;
  error?: string;
}

async function refreshRegion(region: string): Promise<RegionResult> {
  try {
    const trends = process.env.YOUTUBE_API_KEY
      ? await fetchYoutubeTrends(region)
      : getMockTrends(region);
    await saveTrendSnapshot(trends);
    return { region, mocked: trends.mocked, items: trends.items.length };
  } catch (err) {
    console.error(`refreshRegion(${region}): live fetch failed, saving mock fallback`, err);
    const trends = getMockTrends(region);
    await saveTrendSnapshot(trends);
    return {
      region,
      mocked: trends.mocked,
      items: trends.items.length,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * POST /api/cron/refresh-trends
 *
 * Scheduled ingestion job: fetches + aggregates + saves a snapshot for
 * every region in SUPPORTED_REGIONS. This is the only place that should
 * call the live YouTube API on a schedule — /api/trends itself now serves
 * from these stored snapshots (see getFreshTrendSnapshot) so normal page
 * traffic doesn't burn quota.
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const regions = await Promise.all(SUPPORTED_REGIONS.map(refreshRegion));

  return NextResponse.json({
    refreshedAt: new Date().toISOString(),
    regions,
  });
}
