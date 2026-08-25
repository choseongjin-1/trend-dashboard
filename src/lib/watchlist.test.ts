import { describe, it, expect } from "vitest";
import { describeRankChange } from "./watchlist";

describe("describeRankChange", () => {
  it("returns 'unknown' when current_rank is entirely absent (POST's response shape)", () => {
    expect(describeRankChange({ last_seen_rank: null })).toEqual({ kind: "unknown" });
    expect(describeRankChange({ current_rank: undefined, last_seen_rank: 3 })).toEqual({
      kind: "unknown",
    });
  });

  it("returns 'dropped' when current_rank is explicitly null (confirmed not currently ranked)", () => {
    expect(describeRankChange({ current_rank: null, last_seen_rank: 5 })).toEqual({
      kind: "dropped",
    });
    expect(describeRankChange({ current_rank: null, last_seen_rank: null })).toEqual({
      kind: "dropped",
    });
  });

  it("returns 'new' when ranked now but never acknowledged before", () => {
    expect(describeRankChange({ current_rank: 4, last_seen_rank: null })).toEqual({
      kind: "new",
    });
  });

  it("returns 'unchanged' when current and last-seen rank match", () => {
    expect(describeRankChange({ current_rank: 2, last_seen_rank: 2 })).toEqual({
      kind: "unchanged",
      rank: 2,
    });
  });

  it("returns 'moved' with from/to when the rank differs from the last-seen baseline", () => {
    expect(describeRankChange({ current_rank: 1, last_seen_rank: 3 })).toEqual({
      kind: "moved",
      from: 3,
      to: 1,
    });
    expect(describeRankChange({ current_rank: 8, last_seen_rank: 2 })).toEqual({
      kind: "moved",
      from: 2,
      to: 8,
    });
  });
});
