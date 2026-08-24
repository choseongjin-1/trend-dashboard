import { NextRequest, NextResponse } from "next/server";
import { fetchYoutubeTrends } from "@/lib/trends/youtube";
import { getMockTrends } from "@/lib/trends/mock";

export async function GET(req: NextRequest) {
  const region = req.nextUrl.searchParams.get("region") ?? "KR";

  if (!process.env.YOUTUBE_API_KEY) {
    return NextResponse.json(getMockTrends(region));
  }

  try {
    const trends = await fetchYoutubeTrends(region);
    return NextResponse.json(trends);
  } catch (err) {
    console.error("Failed to fetch YouTube trends, falling back to mock", err);
    return NextResponse.json(getMockTrends(region));
  }
}
