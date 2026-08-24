import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Named `proxy.ts`, not `middleware.ts`: Next.js 16 deprecated the
 * `middleware` file convention and renamed it to `proxy` (same mechanism,
 * new file/export name — see node_modules/next/dist/docs/.../proxy.md).
 *
 * This runs the standard @supabase/ssr session-refresh pattern on every
 * non-static request, so an expiring auth cookie gets refreshed before it
 * reaches a Route Handler (needed for /api/watchlist's session-aware
 * client to see a valid session on longer-lived visits).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  // Touches the session so an expiring token gets refreshed and re-issued
  // via Set-Cookie (through setAll above) before the request continues.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
