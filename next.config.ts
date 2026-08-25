import type { NextConfig } from "next";

/**
 * The only third-party origin the browser itself ever talks to directly is
 * Supabase (the browser client in src/lib/supabase/browser.ts calls its
 * REST/auth endpoints directly, not through our own API routes). Computed
 * from the same env var the app already uses, via `new URL(...).origin`,
 * so this doesn't hardcode one project's hostname and stays correct if the
 * Supabase project ever changes. Everything else — YouTube, Hacker News —
 * is fetched server-side only (src/lib/trends/*.ts), so the browser's CSP
 * doesn't need to allow those hosts at all.
 */
function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function buildCsp(): string {
  const isDev = process.env.NODE_ENV === "development";
  const supabase = supabaseOrigin();
  const connectSrc = ["'self'", supabase].filter(Boolean).join(" ");

  // No nonces: this app has no user-facing need for inline `<script>` tags
  // beyond what Next.js itself emits, and a nonce-based CSP would force
  // every page into dynamic rendering (losing static optimization for `/`
  // and the OG image) for a security gain this app doesn't need yet.
  // 'unsafe-inline' on script/style is the documented no-nonce baseline
  // (see node_modules/next/dist/docs/.../content-security-policy.md,
  // "Without Nonces") — still meaningfully scoped vs. a wildcard, since
  // every directive below is 'self'-only except connect-src's one
  // necessary external origin.
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data:`,
    `font-src 'self'`,
    `connect-src ${connectSrc}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];

  return directives.join("; ");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Belt-and-suspenders with the CSP frame-ancestors directive above —
  // frame-ancestors is what modern browsers actually honor, X-Frame-Options
  // covers any that don't.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: buildCsp() },
  // HSTS only makes sense once the site is actually served over HTTPS
  // (production/Vercel) — sending it in local dev over http:// would be
  // actively wrong (browsers ignore it over http, but there's no reason to
  // even send a directive that can't apply). 2 years + subdomains + preload
  // is the standard "ready for the HSTS preload list" value.
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
