import { describe, expect, it } from "vitest";
import { blendTrendItems, SourceItems } from "./blend";
import { TrendItem } from "./types";

function item(rank: number, keyword: string, source: TrendItem["source"], score: number): TrendItem {
  return { rank, keyword, source, score };
}

describe("blendTrendItems", () => {
  it("interleaves fairly by rank-percentile, not raw score magnitude", () => {
    // YouTube scores are ~10,000x HN's — a raw-score sort would put every
    // YouTube item before every HN item. Percentile-based blending must not.
    const youtube: SourceItems = {
      source: "youtube",
      items: [
        item(1, "yt-1", "youtube", 5_000_000),
        item(2, "yt-2", "youtube", 2_000_000),
      ],
    };
    const hackernews: SourceItems = {
      source: "hackernews",
      items: [
        item(1, "hn-1", "hackernews", 800),
        item(2, "hn-2", "hackernews", 200),
      ],
    };

    const result = blendTrendItems([youtube, hackernews]);

    // Both #1s tie at percentile 1.0 (youtube listed first -> wins tie);
    // both #2s tie at percentile 0.5. hn-1 must outrank yt-2 despite yt-2's
    // vastly larger raw score.
    expect(result.map((r) => r.keyword)).toEqual(["yt-1", "hn-1", "yt-2", "hn-2"]);
  });

  it("reassigns rank 1..N sequentially across the blended list", () => {
    const result = blendTrendItems([
      { source: "youtube", items: [item(1, "a", "youtube", 100)] },
      { source: "hackernews", items: [item(1, "b", "hackernews", 5)] },
    ]);

    expect(result.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("respects the limit across the combined pool", () => {
    const youtube: SourceItems = {
      source: "youtube",
      items: Array.from({ length: 10 }, (_, i) => item(i + 1, `yt-${i}`, "youtube", 100 - i)),
    };
    const hackernews: SourceItems = {
      source: "hackernews",
      items: Array.from({ length: 10 }, (_, i) => item(i + 1, `hn-${i}`, "hackernews", 100 - i)),
    };

    const result = blendTrendItems([youtube, hackernews], 5);

    expect(result).toHaveLength(5);
  });

  it("handles a source contributing zero items without erroring", () => {
    const result = blendTrendItems([
      { source: "youtube", items: [item(1, "solo", "youtube", 10)] },
      { source: "hackernews", items: [] },
    ]);

    expect(result.map((r) => r.keyword)).toEqual(["solo"]);
  });

  it("returns an empty array when every source is empty", () => {
    expect(blendTrendItems([{ source: "youtube", items: [] }])).toEqual([]);
  });
});
