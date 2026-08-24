import { NextRequest, NextResponse } from "next/server";
import { fetchYoutubeTrends } from "@/lib/trends/youtube";
import { getMockTrends } from "@/lib/trends/mock";
import { getFreshTrendSnapshot, saveTrendSnapshot, snapshotRowToResponse } from "@/lib/trends/persist";
import { normalizeRegion } from "@/lib/trends/regions";
import { TrendsResponse } from "@/lib/trends/types";
import { checkRateLimit, getClientIdentifier, rateLimitResponse } from "@/lib/rate-limit";

// A normal session (page load + a manual refresh or two, or switching
// regions a few times) is well under 10 requests/minute; 30 leaves
// generous headroom for that while still capping scripted/bot abuse of a
// public, unauthenticated read endpoint.
const RATE_LIMIT_PER_MINUTE = 30;

/**
 * Fires the snapshot persistence off without ever letting it affect the
 * HTTP response — persistence is best-effort. saveTrendSnapshot() already
 * catches its own errors, but we guard again here in case that contract
 * ever changes.
 */
function persistInBackground(trends: TrendsResponse) {
  saveTrendSnapshot(trends).catch((err) => {
    console.error("Failed to persist trend snapshot", err);
  });
}

export async function GET(req: NextRequest) {
  const rateLimit = await checkRateLimit("trends", getClientIdentifier(req), RATE_LIMIT_PER_MINUTE);
  if (!rateLimit.allowed) {
    return rateLimitResponse(rateLimit);
  }

  const region = normalizeRegion(req.nextUrl.searchParams.get("region"));

  // DB-first: serve a recent snapshot straight from Supabase when one
  // exists, so normal page traffic never burns YouTube quota. Falls
  // through to a live fetch on cold start or when Supabase is unconfigured
  // (getFreshTrendSnapshot resolves to null in both cases).
  const cached = await getFreshTrendSnapshot(region);
  if (cached) {
    return NextResponse.json(snapshotRowToResponse(cached));
  }

  if (!process.env.YOUTUBE_API_KEY) {
    const trends = getMockTrends(region);
    persistInBackground(trends);
    return NextResponse.json(trends);
  }

  try {
    const trends = await fetchYoutubeTrends(region);
    persistInBackground(trends);
    return NextResponse.json(trends);
  } catch (err) {
    console.error("Failed to fetch YouTube trends, falling back to mock", err);
    const trends = getMockTrends(region);
    persistInBackground(trends);
    return NextResponse.json(trends);
  }
}
