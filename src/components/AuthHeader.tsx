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
    return <div className="h-8 w-24 animate-pulse rounded-full bg-surface-2" />;
  }

  if (!user) {
    return (
      <button
        onClick={onOpenAuth}
        className="rounded-full border border-signal/40 px-4 py-1.5 text-sm font-medium text-signal transition hover:bg-signal/10"
      >
        로그인
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signal/15 font-display text-xs font-bold text-signal"
      >
        {user.email.charAt(0).toUpperCase()}
      </span>
      <span className="hidden text-sm text-text-dim sm:inline">{user.email}</span>
      <button
        onClick={onSignOut}
        className="rounded-full border border-hairline px-3 py-1.5 text-xs text-text-dim transition hover:border-signal/40 hover:text-text"
      >
        로그아웃
      </button>
    </div>
  );
}
