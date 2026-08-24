import { describe, it, expect } from "vitest";
import { sourceLabel } from "./sourceLabel";

describe("sourceLabel", () => {
  it("returns the known display label for youtube", () => {
    expect(sourceLabel("youtube")).toBe("YouTube");
  });

  it("title-cases an unrecognized source as a fallback", () => {
    expect(sourceLabel("hackernews")).toBe("Hackernews");
    expect(sourceLabel("hacker-news")).toBe("Hacker News");
    expect(sourceLabel("some_source")).toBe("Some Source");
  });
});
