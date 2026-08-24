import { describe, expect, it } from "vitest";
import { isSnapshotFresh } from "./persist";

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
