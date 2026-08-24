import { describe, expect, it } from "vitest";
import { DEFAULT_REGION, SUPPORTED_REGIONS, isSupportedRegion, normalizeRegion } from "./regions";

describe("isSupportedRegion", () => {
  it("accepts every code in SUPPORTED_REGIONS", () => {
    for (const region of SUPPORTED_REGIONS) {
      expect(isSupportedRegion(region)).toBe(true);
    }
  });

  it("rejects an unsupported code", () => {
    expect(isSupportedRegion("FR")).toBe(false);
  });
});

describe("normalizeRegion", () => {
  it("passes through a supported uppercase code", () => {
    expect(normalizeRegion("US")).toBe("US");
  });

  it("is case-insensitive", () => {
    expect(normalizeRegion("jp")).toBe("JP");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeRegion("  kr  ")).toBe("KR");
  });

  it("falls back to DEFAULT_REGION for an unsupported code", () => {
    expect(normalizeRegion("FR")).toBe(DEFAULT_REGION);
  });

  it("falls back to DEFAULT_REGION for null/undefined/empty input", () => {
    expect(normalizeRegion(null)).toBe(DEFAULT_REGION);
    expect(normalizeRegion(undefined)).toBe(DEFAULT_REGION);
    expect(normalizeRegion("")).toBe(DEFAULT_REGION);
  });
});
