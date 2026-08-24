import { afterEach, describe, expect, it, vi } from "vitest";
import { TrendItem } from "./types";

const fetchYoutubeItems = vi.fn();
const fetchHackerNewsItems = vi.fn();

vi.mock("./youtube", () => ({ fetchYoutubeItems: (...args: unknown[]) => fetchYoutubeItems(...args) }));
vi.mock("./hackernews", () => ({
  fetchHackerNewsItems: (...args: unknown[]) => fetchHackerNewsItems(...args),
}));

const { buildTrendsResponse } = await import("./ingest");

function ytItem(rank: number, keyword: string): TrendItem {
  return { rank, keyword, source: "youtube", score: 1_000_000 - rank };
}
function hnItem(rank: number, keyword: string): TrendItem {
  return { rank, keyword, source: "hackernews", score: 500 - rank };
}

describe("buildTrendsResponse", () => {
  const originalKey = process.env.YOUTUBE_API_KEY;

  afterEach(() => {
    vi.clearAllMocks();
    process.env.YOUTUBE_API_KEY = originalKey;
  });

  it("blends both sources when both succeed live", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    fetchYoutubeItems.mockResolvedValue([ytItem(1, "yt-a")]);
    fetchHackerNewsItems.mockResolvedValue([hnItem(1, "hn-a")]);

    const result = await buildTrendsResponse("KR");

    expect(result.mocked).toBe(false);
    expect(result.sources).toEqual(["youtube", "hackernews"]);
    expect(result.region).toBe("KR");
    expect(result.items.map((i) => i.keyword).sort()).toEqual(["hn-a", "yt-a"]);
  });

  it("marks mocked=true when YouTube has no API key, even if HN succeeds live", async () => {
    delete process.env.YOUTUBE_API_KEY;
    fetchHackerNewsItems.mockResolvedValue([hnItem(1, "hn-a")]);

    const result = await buildTrendsResponse("KR");

    expect(result.mocked).toBe(true);
    expect(fetchYoutubeItems).not.toHaveBeenCalled();
    expect(result.items.some((i) => i.source === "youtube")).toBe(true);
    expect(result.items.some((i) => i.source === "hackernews")).toBe(true);
  });

  it("falls back to mock YouTube items when the live fetch throws, HN unaffected", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    fetchYoutubeItems.mockRejectedValue(new Error("network error"));
    fetchHackerNewsItems.mockResolvedValue([hnItem(1, "hn-a")]);

    const result = await buildTrendsResponse("KR");

    expect(result.mocked).toBe(true);
    expect(result.items.some((i) => i.source === "youtube")).toBe(true);
  });

  it("falls back to mock HN items when the live HN fetch throws, YouTube unaffected", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    fetchYoutubeItems.mockResolvedValue([ytItem(1, "yt-a")]);
    fetchHackerNewsItems.mockRejectedValue(new Error("HN down"));

    const result = await buildTrendsResponse("KR");

    expect(result.mocked).toBe(true);
    expect(result.items.some((i) => i.source === "hackernews")).toBe(true);
  });

  it("blends the same HN call regardless of region (HN has no region concept)", async () => {
    process.env.YOUTUBE_API_KEY = "test-key";
    fetchYoutubeItems.mockResolvedValue([ytItem(1, "yt-a")]);
    fetchHackerNewsItems.mockResolvedValue([hnItem(1, "hn-a")]);

    await buildTrendsResponse("US");

    expect(fetchHackerNewsItems).toHaveBeenCalledWith();
  });
});
