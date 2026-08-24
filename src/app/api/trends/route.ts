import { NextRequest, NextResponse } from "next/server";
import { fetchYoutubeTrends } from "@/lib/trends/youtube";
import { getMockTrends } from "@/lib/trends/mock";
import { getFreshTrendSnapshot, saveTrendSnapshot, snapshotRowToResponse } from "@/lib/trends/persist";
import { normalizeRegion } from "@/lib/trends/regions";
import { TrendsResponse } from "@/lib/trends/types";

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
