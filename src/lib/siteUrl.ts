/**
 * Canonical origin for absolute URLs (OG/Twitter metadata, sitemap.xml,
 * robots.txt) — used everywhere instead of each call site hardcoding its
 * own fallback, after `NEXT_PUBLIC_SITE_URL` being unset in Vercel once
 * silently pointed every one of these at localhost in production (see
 * LOOP_LOG.md round 16).
 *
 * Order: an explicit `NEXT_PUBLIC_SITE_URL` always wins (lets a real
 * decision override the guess). Otherwise, on Vercel,
 * `VERCEL_PROJECT_PRODUCTION_URL` is a platform-provided env var that
 * names the stable production domain with no manual setup required (unlike
 * `VERCEL_URL`, it does NOT change per preview deploy) — Vercel supplies it
 * bare, without a scheme, so it's prefixed with https:// here. Neither env
 * var exists during a local `next build`/`next dev`, so localhost is the
 * true last resort, for local development only.
 */
export function getSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit;

  const vercelProductionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (vercelProductionHost) return `https://${vercelProductionHost}`;

  return "http://localhost:3000";
}
