import { describe, expect, it } from "vitest";
import { aggregateHackerNewsItems, HackerNewsStory } from "./hackernews";

function story(id: number, title: string | undefined, score: number | undefined, url?: string): HackerNewsStory {
  return { id, title, score, url, type: "story" };
}

describe("aggregateHackerNewsItems", () => {
  it("ranks stories by score, descending", () => {
    const stories = [
      story(1, "Low score story", 10),
      story(2, "High score story", 500),
      story(3, "Mid score story", 100),
    ];

    const result = aggregateHackerNewsItems(stories);

    expect(result.map((r) => r.keyword)).toEqual([
      "High score story",
      "Mid score story",
      "Low score story",
    ]);
    expect(result[0]).toMatchObject({ rank: 1, score: 500, source: "hackernews" });
    expect(result[2]).toMatchObject({ rank: 3, score: 10, source: "hackernews" });
  });

  it("skips stories without a title", () => {
    const stories = [story(1, "Real story", 50), story(2, undefined, 999), story(3, "  ", 999)];

    const result = aggregateHackerNewsItems(stories);

    expect(result).toHaveLength(1);
    expect(result[0].keyword).toBe("Real story");
  });

  it("treats a missing score as zero", () => {
    const result = aggregateHackerNewsItems([story(1, "No score field", undefined)]);
    expect(result[0].score).toBe(0);
  });

  it("passes through url when present", () => {
    const result = aggregateHackerNewsItems([story(1, "Has a link", 10, "https://example.com")]);
    expect(result[0].url).toBe("https://example.com");
  });

  it("respects the limit parameter", () => {
    const stories = Array.from({ length: 30 }, (_, i) => story(i, `story-${i}`, 30 - i));

    const result = aggregateHackerNewsItems(stories, 5);

    expect(result).toHaveLength(5);
    expect(result[0].keyword).toBe("story-0");
  });
});
