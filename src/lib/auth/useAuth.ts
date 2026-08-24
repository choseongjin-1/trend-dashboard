"use client";

import { useCallback, useEffect, useState } from "react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export interface AuthUser {
  email: string;
}

export interface UseAuthResult {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  signUp: (email: string, password: string) => Promise<boolean>;
  signIn: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
}

/**
 * Thin reactive wrapper around Supabase email/password auth.
 *
 * When Supabase isn't configured (`getSupabaseBrowserClient()` returns
 * null), resolves immediately to a logged-out, inert state — sign up/in
 * calls report an error instead of throwing, so callers can always render a
 * logged-out UI safely.
 */
export function useAuth(): UseAuthResult {
  const [user, setUser] = useState<AuthUser | null>(null);
  // No Supabase client configured means there's nothing to wait on.
  const [loading, setLoading] = useState(() => getSupabaseBrowserClient() !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user?.email ? { email: data.session.user.email } : null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user?.email ? { email: session.user.email } : null);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    setError(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("인증 기능을 사용할 수 없습니다.");
      return false;
    }
    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Points the confirmation email link at our callback route rather
        // than relying solely on the Supabase dashboard's Site URL — works
        // correctly in both local dev and production regardless of what
        // that's set to.
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (signUpError) {
      setError(signUpError.message);
      return false;
    }
    return true;
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    setError(null);
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setError("인증 기능을 사용할 수 없습니다.");
      return false;
    }
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError(signInError.message);
      return false;
    }
    return true;
  }, []);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;
    await supabase.auth.signOut();
  }, []);

  return { user, loading, error, signUp, signIn, signOut };
}
