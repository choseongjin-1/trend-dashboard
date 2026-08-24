import type { AuthUser } from "@/lib/auth/useAuth";

interface AuthHeaderProps {
  user: AuthUser | null;
  loading: boolean;
  onSignOut: () => void;
  onOpenAuth: () => void;
}

/**
 * Logged-out vs logged-in header state. Presentational only — all auth
 * wiring lives in the `useAuth` hook one level up.
 */
export function AuthHeader({ user, loading, onSignOut, onOpenAuth }: AuthHeaderProps) {
  if (loading) {
    return <div className="h-8 w-24 animate-pulse rounded-sm bg-casing" />;
  }

  if (!user) {
    return (
      <button
        onClick={onOpenAuth}
        className="rounded-sm border border-ink/40 px-4 py-1.5 font-data text-xs tracking-wide text-ink transition hover:bg-ink/10"
      >
        로그인
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-ink/10 font-display text-xs text-ink"
      >
        {user.email.charAt(0).toUpperCase()}
      </span>
      <span className="hidden font-data text-xs text-ink-dim sm:inline">{user.email}</span>
      <button
        onClick={onSignOut}
        className="rounded-sm border border-ink-dim/25 px-3 py-1.5 font-data text-[11px] text-ink-dim transition hover:border-ink/40 hover:text-ink"
      >
        로그아웃
      </button>
    </div>
  );
}
