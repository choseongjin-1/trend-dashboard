import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const rpc = vi.fn();
const getSupabaseServerClient = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: () => getSupabaseServerClient(),
}));

const { checkRateLimit, getClientIdentifier } = await import("./rate-limit");

describe("checkRateLimit", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("allows the request and returns limit as remaining when Supabase isn't configured", async () => {
    getSupabaseServerClient.mockReturnValue(null);

    const result = await checkRateLimit("trends", "1.2.3.4", 30);

    expect(result).toEqual({
      allowed: true,
      limit: 30,
      remaining: 30,
      resetAt: expect.any(String),
    });
  });

  it("allows and reports remaining budget when under the limit", async () => {
    getSupabaseServerClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: 5, error: null });

    const result = await checkRateLimit("trends", "1.2.3.4", 30);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(25);
    expect(rpc).toHaveBeenCalledWith("increment_rate_limit", {
      p_key: "trends:1.2.3.4",
      p_window_start: expect.any(String),
    });
  });

  it("denies once the count exceeds the limit", async () => {
    getSupabaseServerClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: 31, error: null });

    const result = await checkRateLimit("trends", "1.2.3.4", 30);

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("allows exactly at the limit boundary (count === limit)", async () => {
    getSupabaseServerClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: 30, error: null });

    const result = await checkRateLimit("trends", "1.2.3.4", 30);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("fails open (allowed) when the RPC returns an error, e.g. migration not applied yet", async () => {
    getSupabaseServerClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: null, error: { message: "function increment_rate_limit does not exist" } });

    const result = await checkRateLimit("trends", "1.2.3.4", 30);

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(30);
  });

  it("fails open when the RPC call throws", async () => {
    getSupabaseServerClient.mockReturnValue({ rpc });
    rpc.mockRejectedValue(new Error("network error"));

    const result = await checkRateLimit("trends", "1.2.3.4", 30);

    expect(result.allowed).toBe(true);
  });

  it("uses independent buckets per route key", async () => {
    getSupabaseServerClient.mockReturnValue({ rpc });
    rpc.mockResolvedValue({ data: 1, error: null });

    await checkRateLimit("trends-history", "1.2.3.4", 30);

    expect(rpc).toHaveBeenCalledWith(
      "increment_rate_limit",
      expect.objectContaining({ p_key: "trends-history:1.2.3.4" })
    );
  });
});

describe("getClientIdentifier", () => {
  it("prefers the first entry in x-forwarded-for", () => {
    const req = new NextRequest("https://example.com/api/trends", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    });
    expect(getClientIdentifier(req)).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new NextRequest("https://example.com/api/trends", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(getClientIdentifier(req)).toBe("198.51.100.7");
  });

  it("falls back to a shared 'unknown' bucket when neither header is present", () => {
    const req = new NextRequest("https://example.com/api/trends");
    expect(getClientIdentifier(req)).toBe("unknown");
  });
});
