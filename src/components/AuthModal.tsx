"use client";

import { useState } from "react";

interface AuthModalProps {
  open: boolean;
  error: string | null;
  onClose: () => void;
  onSignIn: (email: string, password: string) => Promise<boolean>;
  onSignUp: (email: string, password: string) => Promise<boolean>;
}

/**
 * Email/password sign in + sign up in one panel. Success closes the modal;
 * `useAuth`'s onAuthStateChange listener (in the parent) picks up the new
 * session and flips the header to the logged-in state.
 */
export function AuthModal({ open, error, onClose, onSignIn, onSignUp }: AuthModalProps) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setNotice(null);
    const ok = mode === "signin" ? await onSignIn(email, password) : await onSignUp(email, password);
    setSubmitting(false);
    if (ok && mode === "signin") {
      onClose();
    } else if (ok && mode === "signup") {
      setNotice("가입 확인 이메일을 보냈습니다. 메일함을 확인해주세요.");
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "signin" ? "로그인" : "회원가입"}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
      onClick={onClose}
    >
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg border border-hairline bg-surface p-6"
      >
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-lg font-bold text-text">
            {mode === "signin" ? "로그인" : "회원가입"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="text-text-dim hover:text-text"
          >
            ✕
          </button>
        </div>

        <label className="mb-3 block text-xs text-text-dim">
          이메일
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm text-text outline-none focus:border-signal/60"
          />
        </label>

        <label className="mb-4 block text-xs text-text-dim">
          비밀번호
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-hairline bg-bg px-3 py-2 text-sm text-text outline-none focus:border-signal/60"
          />
        </label>

        {error && (
          <p role="alert" className="mb-3 text-xs text-fall">
            {error}
          </p>
        )}
        {notice && <p className="mb-3 text-xs text-rise">{notice}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-signal px-3 py-2 text-sm font-semibold text-bg transition hover:bg-signal/90 disabled:opacity-50"
        >
          {submitting ? "처리 중..." : mode === "signin" ? "로그인" : "가입하기"}
        </button>

        <button
          type="button"
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-3 w-full text-center text-xs text-text-dim underline decoration-hairline underline-offset-2 hover:text-signal"
        >
          {mode === "signin" ? "계정이 없으신가요? 회원가입" : "이미 계정이 있으신가요? 로그인"}
        </button>
      </form>
    </div>
  );
}
