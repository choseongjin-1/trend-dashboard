import { TrendItem, TrendsResponse } from "./types";

const YOUTUBE_API_URL = "https://www.googleapis.com/youtube/v3/videos";

export interface YouTubeVideoItem {
  id: string;
  snippet: {
    title: string;
    tags?: string[];
  };
  statistics: {
    viewCount?: string;
  };
}

/**
 * Pure aggregation/ranking step: turns raw YouTube video items into a
 * ranked TrendItem[] by summing view counts per keyword/tag.
 *
 * Deliberately has no network/env dependency so it can be unit tested
 * with plain fixture data.
 */
export function aggregateTrendItems(
  videos: YouTubeVideoItem[],
  limit = 20
): TrendItem[] {
  const keywordScores = new Map<string, number>();

  for (const video of videos) {
    const views = Number(video.statistics.viewCount ?? 0);
    const tags = video.snippet.tags?.length
      ? video.snippet.tags
      : [video.snippet.title];
    for (const tag of tags) {
      const key = tag.trim();
      if (!key) continue;
      keywordScores.set(key, (keywordScores.get(key) ?? 0) + views);
    }
  }

  return Array.from(keywordScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword, score], i) => ({
      rank: i + 1,
      keyword,
      source: "youtube",
      score,
    }));
}

export async function fetchYoutubeTrends(region: string): Promise<TrendsResponse> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    throw new Error("YOUTUBE_API_KEY is not set");
  }

  const url = new URL(YOUTUBE_API_URL);
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", region);
  url.searchParams.set("maxResults", "25");
  url.searchParams.set("key", apiKey);

  const res = await fetch(url.toString(), { next: { revalidate: 300 } });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as { items: YouTubeVideoItem[] };

  const items = aggregateTrendItems(data.items);

  return {
    source: "youtube",
    region,
    fetchedAt: new Date().toISOString(),
    mocked: false,
    items,
  };
}
