import { NextRequest, NextResponse } from "next/server";
import { buildTrendsResponse } from "@/lib/trends/ingest";
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
  // exists, so normal page traffic never re-fetches every source. Falls
  // through to a live fetch on cold start or when Supabase is unconfigured
  // (getFreshTrendSnapshot resolves to null in both cases).
  const cached = await getFreshTrendSnapshot(region);
  if (cached) {
    return NextResponse.json(snapshotRowToResponse(cached));
  }

  // buildTrendsResponse fetches + blends every source (YouTube, Hacker
  // News) and never throws — each source degrades to mock data
  // independently on failure. See src/lib/trends/ingest.ts.
  const trends = await buildTrendsResponse(region);
  persistInBackground(trends);
  return NextResponse.json(trends);
}
