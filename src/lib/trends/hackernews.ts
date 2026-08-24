import { TrendItem } from "./types";

const HN_API_BASE = "https://hacker-news.firebaseio.com/v0";

// Fetch a bit more than the blend needs so aggregation has real depth to
// rank within (score-sorting 30 candidates down to ~20 is more meaningful
// than just taking the API's first 20 in whatever order it returns).
const STORIES_TO_FETCH = 30;

export interface HackerNewsStory {
  id: number;
  title?: string;
  score?: number;
  url?: string;
  type?: string;
}

/**
 * Pure aggregation/ranking step: turns raw HN story items into a ranked
 * TrendItem[] by score, descending. Mirrors aggregateTrendItems in
 * youtube.ts — no network/env dependency, unit-testable with fixture data.
 *
 * Stories without a title (shouldn't normally happen for the "story" type
 * HN's topstories.json returns, but the API doesn't guarantee it) are
 * skipped rather than surfaced as blank items.
 */
export function aggregateHackerNewsItems(
  stories: HackerNewsStory[],
  limit = 20
): TrendItem[] {
  return stories
    .filter((s): s is HackerNewsStory & { title: string } => Boolean(s.title?.trim()))
    .slice()
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit)
    .map((story, i) => ({
      rank: i + 1,
      keyword: story.title.trim(),
      source: "hackernews" as const,
      score: story.score ?? 0,
      url: story.url,
    }));
}

/**
 * Fetches + aggregates Hacker News's top stories. No API key or credential
 * required — this is a free, public, unauthenticated API, unlike YouTube's
 * key-gated one, so there's no "not configured" branch: every call
 * attempts a real fetch and either succeeds or throws.
 *
 * A single story's detail fetch failing doesn't fail the whole batch —
 * that story is just dropped from consideration (partial degrade). Only a
 * failure fetching the ID list itself, or every single detail fetch
 * failing, throws — callers (src/lib/trends/ingest.ts) catch that and fall
 * back to mock items.
 */
export async function fetchHackerNewsItems(limit = 20): Promise<TrendItem[]> {
  const idsRes = await fetch(`${HN_API_BASE}/topstories.json`, {
    next: { revalidate: 300 },
  });
  if (!idsRes.ok) {
    throw new Error(`Hacker News topstories error ${idsRes.status}`);
  }

  const ids = (await idsRes.json()) as number[];
  const topIds = ids.slice(0, STORIES_TO_FETCH);

  const stories = await Promise.all(
    topIds.map(async (id) => {
      const res = await fetch(`${HN_API_BASE}/item/${id}.json`, {
        next: { revalidate: 300 },
      });
      if (!res.ok) return null;
      return (await res.json()) as HackerNewsStory;
    })
  );

  const validStories = stories.filter((s): s is HackerNewsStory => s !== null);
  if (validStories.length === 0 && topIds.length > 0) {
    throw new Error("Hacker News: every story detail fetch failed");
  }

  return aggregateHackerNewsItems(validStories, limit);
}
