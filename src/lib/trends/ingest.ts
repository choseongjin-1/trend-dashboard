import { fetchYoutubeItems } from "./youtube";
import { fetchHackerNewsItems } from "./hackernews";
import { getMockYoutubeItems, getMockHackerNewsItems } from "./mock";
import { blendTrendItems } from "./blend";
import { TrendItem, TrendSource, TrendsResponse } from "./types";

const BLEND_LIMIT = 20;

interface SourceResult {
  source: TrendSource;
  items: TrendItem[];
  mocked: boolean;
}

async function getYoutubeSource(region: string): Promise<SourceResult> {
  if (!process.env.YOUTUBE_API_KEY) {
    return { source: "youtube", items: getMockYoutubeItems(), mocked: true };
  }
  try {
    return { source: "youtube", items: await fetchYoutubeItems(region), mocked: false };
  } catch (err) {
    console.error("getYoutubeSource: live fetch failed, falling back to mock", err);
    return { source: "youtube", items: getMockYoutubeItems(), mocked: true };
  }
}

/**
 * Hacker News is a free, unauthenticated API — there's no "not configured"
 * branch like YouTube's API-key gate. Every call attempts a real fetch.
 */
async function getHackerNewsSource(): Promise<SourceResult> {
  try {
    return { source: "hackernews", items: await fetchHackerNewsItems(), mocked: false };
  } catch (err) {
    console.error("getHackerNewsSource: live fetch failed, falling back to mock", err);
    return { source: "hackernews", items: getMockHackerNewsItems(), mocked: true };
  }
}

/**
 * Fetches every source and blends them into one TrendsResponse for a
 * region. This is the single place that decides how sources compose —
 * both /api/trends and the refresh-trends cron job call this rather than
 * each re-implementing fetch/mock-fallback/blend logic.
 *
 * Region mapping: Hacker News has no region concept (it's a single global
 * feed), so its items are blended into every region's response equally —
 * the same top HN stories appear in the KR, US, and JP responses. This is
 * a deliberate choice, not an oversight: HN doesn't localize, so pretending
 * it does for one region and excluding it from others would be arbitrary.
 * See LOOP_LOG.md for the full reasoning and the rejected alternative.
 *
 * `mocked` is true if ANY source fell back to mock data — a response
 * containing even one mocked source is not fully real, so the "mocked"
 * signal should reflect that rather than only firing when everything is
 * fake.
 */
export async function buildTrendsResponse(region: string): Promise<TrendsResponse> {
  const [youtube, hackernews] = await Promise.all([
    getYoutubeSource(region),
    getHackerNewsSource(),
  ]);

  const items = blendTrendItems(
    [
      { source: youtube.source, items: youtube.items },
      { source: hackernews.source, items: hackernews.items },
    ],
    BLEND_LIMIT
  );

  return {
    sources: [youtube.source, hackernews.source],
    region,
    fetchedAt: new Date().toISOString(),
    mocked: youtube.mocked || hackernews.mocked,
    items,
  };
}
