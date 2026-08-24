import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const WINDOW_SECONDS = 60;

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: string;
}

/** Start of the current fixed window, floored to WINDOW_SECONDS. */
function currentWindowStart(now = Date.now()): Date {
  const windowMs = WINDOW_SECONDS * 1000;
  return new Date(Math.floor(now / windowMs) * windowMs);
}

/**
 * Fixed-window rate limiter backed by the `increment_rate_limit` Postgres
 * function (supabase/migrations/0003_rate_limiting.sql). See that file for
 * the fixed-vs-sliding-window tradeoff.
 *
 * Safe no-op (always allowed) when Supabase is unconfigured, the RPC
 * fails, or the migration hasn't been applied yet — same "never block
 * real usage" discipline as the rest of the persistence layer.
 */
export async function checkRateLimit(
  routeKey: string,
  identifier: string,
  limit: number
): Promise<RateLimitResult> {
  const windowStart = currentWindowStart();
  const resetAt = new Date(windowStart.getTime() + WINDOW_SECONDS * 1000).toISOString();
  const fallback: RateLimitResult = { allowed: true, limit, remaining: limit, resetAt };

  const client = getSupabaseServerClient();
  if (!client) return fallback;

  try {
    const { data, error } = await client.rpc("increment_rate_limit", {
      p_key: `${routeKey}:${identifier}`,
      p_window_start: windowStart.toISOString(),
    });

    if (error) {
      console.error("checkRateLimit: rpc failed", error);
      return fallback;
    }

    const count = typeof data === "number" ? data : Number(data);
    if (!Number.isFinite(count)) return fallback;

    return {
      allowed: count <= limit,
      limit,
      remaining: Math.max(0, limit - count),
      resetAt,
    };
  } catch (err) {
    console.error("checkRateLimit: unexpected error", err);
    return fallback;
  }
}

/** Standard 429 response body/headers for a rejected RateLimitResult. */
export function rateLimitResponse(result: RateLimitResult): NextResponse {
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((new Date(result.resetAt).getTime() - Date.now()) / 1000)
  );

  return NextResponse.json(
    { error: "rate_limited", message: "Too many requests. Please slow down." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": result.resetAt,
      },
    }
  );
}

/**
 * Best-effort client identifier for rate limiting. `x-forwarded-for` is
 * what Vercel (and most reverse proxies) set to the real client IP; falls
 * back to `x-real-ip`, then a shared "unknown" bucket for direct/local
 * requests with neither header (acceptable for a coarse abuse filter —
 * local dev and unproxied requests just share one bucket).
 */
export function getClientIdentifier(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0].trim();

  const realIp = req.headers.get("x-real-ip");
  if (realIp) return realIp;

  return "unknown";
}
