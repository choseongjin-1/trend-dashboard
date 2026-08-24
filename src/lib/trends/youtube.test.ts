import { describe, expect, it } from "vitest";
import { aggregateTrendItems, YouTubeVideoItem } from "./youtube";

function video(
  id: string,
  title: string,
  viewCount: string,
  tags?: string[]
): YouTubeVideoItem {
  return {
    id,
    snippet: { title, tags },
    statistics: { viewCount },
  };
}

describe("aggregateTrendItems", () => {
  it("ranks keywords by summed view count, descending", () => {
    const videos: YouTubeVideoItem[] = [
      video("1", "video A", "100", ["캠핑", "브이로그"]),
      video("2", "video B", "50", ["캠핑"]),
      video("3", "video C", "10", ["요리"]),
    ];

    const result = aggregateTrendItems(videos);

    expect(result.map((r) => r.keyword)).toEqual(["캠핑", "브이로그", "요리"]);
    expect(result[0]).toMatchObject({ rank: 1, keyword: "캠핑", score: 150 });
    expect(result[1]).toMatchObject({ rank: 2, keyword: "브이로그", score: 100 });
    expect(result[2]).toMatchObject({ rank: 3, keyword: "요리", score: 10 });
  });

  it("falls back to the video title when no tags are present", () => {
    const videos: YouTubeVideoItem[] = [video("1", "제목만 있는 영상", "42")];

    const result = aggregateTrendItems(videos);

    expect(result).toEqual([
      { rank: 1, keyword: "제목만 있는 영상", source: "youtube", score: 42 },
    ]);
  });

  it("treats a missing viewCount as zero", () => {
    const videos: YouTubeVideoItem[] = [
      { id: "1", snippet: { title: "조회수 없음" }, statistics: {} },
    ];

    const result = aggregateTrendItems(videos);

    expect(result[0].score).toBe(0);
  });

  it("skips blank/whitespace-only tags", () => {
    const videos: YouTubeVideoItem[] = [video("1", "제목", "10", ["  ", "실제태그"])];

    const result = aggregateTrendItems(videos);

    expect(result.map((r) => r.keyword)).toEqual(["실제태그"]);
  });

  it("respects the limit parameter", () => {
    const videos: YouTubeVideoItem[] = Array.from({ length: 30 }, (_, i) =>
      video(String(i), `title-${i}`, String(30 - i))
    );

    const result = aggregateTrendItems(videos, 5);

    expect(result).toHaveLength(5);
    expect(result[0].keyword).toBe("title-0");
  });
});
