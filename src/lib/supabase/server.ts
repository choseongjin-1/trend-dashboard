import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Service-role client: bypasses Row Level Security entirely. Only for
 * server-side ingestion code (persist.ts) that writes/reads on behalf of
 * the whole app, never for anything scoped to an individual user.
 */
export function getSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Request-scoped, auth-session-aware Supabase client for use inside Route
 * Handlers (App Router). Reads the caller's session from cookies via
 * @supabase/ssr's createServerClient, so queries run as that user and are
 * subject to Row Level Security — this is what per-user CRUD routes (e.g.
 * /api/watchlist) must use instead of the service-role client above.
 *
 * Returns null when Supabase env vars aren't configured, matching
 * getSupabaseServerClient()'s contract.
 */
export async function getSupabaseRouteHandlerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // Called from a context that can't set cookies (e.g. rendering
          // a Server Component). Safe to ignore — proxy.ts refreshes the
          // session for the surrounding request regardless.
        }
      },
    },
  });
}
