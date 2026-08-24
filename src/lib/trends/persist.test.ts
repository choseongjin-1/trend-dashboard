import { describe, expect, it } from "vitest";
import { extractKeywordHistory, isSnapshotFresh, TrendSnapshotRow } from "./persist";

function snapshot(fetchedAt: string, items: TrendSnapshotRow["items"]): TrendSnapshotRow {
  return {
    id: fetchedAt,
    source: "youtube",
    region: "KR",
    fetched_at: fetchedAt,
    mocked: false,
    items,
    created_at: fetchedAt,
  };
}

describe("isSnapshotFresh", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");

  it("is fresh when well within the window", () => {
    const fetchedAt = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
    expect(isSnapshotFresh(fetchedAt, 15 * 60 * 1000, now)).toBe(true);
  });

  it("is fresh exactly at the boundary", () => {
    const fetchedAt = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
    expect(isSnapshotFresh(fetchedAt, 15 * 60 * 1000, now)).toBe(true);
  });

  it("is stale just past the boundary", () => {
    const fetchedAt = new Date(now.getTime() - 15 * 60 * 1000 - 1).toISOString();
    expect(isSnapshotFresh(fetchedAt, 15 * 60 * 1000, now)).toBe(false);
  });

  it("is stale for a timestamp far in the past", () => {
    const fetchedAt = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
    expect(isSnapshotFresh(fetchedAt, 15 * 60 * 1000, now)).toBe(false);
  });

  it("treats an unparsable timestamp as stale, not a crash", () => {
    expect(isSnapshotFresh("not-a-date", 15 * 60 * 1000, now)).toBe(false);
  });
});

describe("extractKeywordHistory", () => {
  it("pulls one keyword's rank/score out of each snapshot, oldest first", () => {
    const snapshots = [
      snapshot("2026-08-24T12:15:00.000Z", [
        { rank: 2, keyword: "BIGBANG", source: "youtube", score: 200 },
      ]),
      snapshot("2026-08-24T12:00:00.000Z", [
        { rank: 1, keyword: "BIGBANG", source: "youtube", score: 100 },
      ]),
    ];

    expect(extractKeywordHistory(snapshots, "BIGBANG")).toEqual([
      { fetchedAt: "2026-08-24T12:00:00.000Z", rank: 1, score: 100 },
      { fetchedAt: "2026-08-24T12:15:00.000Z", rank: 2, score: 200 },
    ]);
  });

  it("skips snapshots where the keyword didn't appear, without erroring", () => {
    const snapshots = [
      snapshot("2026-08-24T12:00:00.000Z", [
        { rank: 1, keyword: "BIGBANG", source: "youtube", score: 100 },
      ]),
      snapshot("2026-08-24T12:15:00.000Z", [
        { rank: 1, keyword: "someone else", source: "youtube", score: 999 },
      ]),
    ];

    expect(extractKeywordHistory(snapshots, "BIGBANG")).toEqual([
      { fetchedAt: "2026-08-24T12:00:00.000Z", rank: 1, score: 100 },
    ]);
  });

  it("returns an empty array when the keyword never appears", () => {
    const snapshots = [
      snapshot("2026-08-24T12:00:00.000Z", [
        { rank: 1, keyword: "someone else", source: "youtube", score: 100 },
      ]),
    ];

    expect(extractKeywordHistory(snapshots, "BIGBANG")).toEqual([]);
  });

  it("returns an empty array for an empty snapshot list", () => {
    expect(extractKeywordHistory([], "BIGBANG")).toEqual([]);
  });
});
