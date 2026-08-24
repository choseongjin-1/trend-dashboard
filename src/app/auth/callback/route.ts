import { NextRequest, NextResponse } from "next/server";
import { getSupabaseRouteHandlerClient } from "@/lib/supabase/server";

/**
 * GET /auth/callback?code=...&next=/
 *
 * Handles the redirect Supabase sends after a user clicks an email
 * confirmation link. @supabase/ssr's browser/server clients both default
 * to `flowType: "pkce"` (see node_modules/@supabase/ssr/dist/module/
 * create{Browser,Server}Client.js — checked directly rather than assumed),
 * so the link carries a `?code=` param that must be exchanged for a
 * session here. This is the standard @supabase/ssr + App Router pattern,
 * not a magic-link/OTP `token_hash` flow.
 *
 * Always redirects — never renders a blank page or throws — so a
 * missing/expired/already-used code just lands the user back on `/` with
 * an `auth_error` flag instead of a dead page. Frontend can read that
 * param to surface a message; this route's job is just to never leave the
 * user stranded.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");

  const rawNext = searchParams.get("next");
  // Only allow same-origin relative paths as a redirect target — a raw
  // query param is otherwise an open-redirect vector.
  const next = rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/";

  if (code) {
    const supabase = await getSupabaseRouteHandlerClient();
    if (supabase) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        return NextResponse.redirect(new URL(next, origin));
      }
      console.error("auth/callback: exchangeCodeForSession failed", error);
    } else {
      console.error("auth/callback: Supabase not configured");
    }
  }

  return NextResponse.redirect(new URL("/?auth_error=1", origin));
}
