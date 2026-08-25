import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getSiteUrl } from "./siteUrl";

describe("getSiteUrl", () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("prefers an explicit NEXT_PUBLIC_SITE_URL over everything else", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://custom.example.com";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "trend-dashboard-swart.vercel.app";
    expect(getSiteUrl()).toBe("https://custom.example.com");
  });

  it("falls back to VERCEL_PROJECT_PRODUCTION_URL, prefixed with https://, when no explicit override is set", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "trend-dashboard-swart.vercel.app";
    expect(getSiteUrl()).toBe("https://trend-dashboard-swart.vercel.app");
  });

  it("falls back to localhost when neither env var is set — the real local-build/local-dev case", () => {
    expect(getSiteUrl()).toBe("http://localhost:3000");
  });

  it("treats an empty-string NEXT_PUBLIC_SITE_URL as unset rather than a literal empty origin", () => {
    process.env.NEXT_PUBLIC_SITE_URL = "";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "trend-dashboard-swart.vercel.app";
    expect(getSiteUrl()).toBe("https://trend-dashboard-swart.vercel.app");
  });
});
