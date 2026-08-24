/**
 * Fixed, extensible list of regions the ingestion pipeline supports.
 * Add a new ISO 3166-1 alpha-2 code here to bring a region online across
 * /api/trends, /api/trends/history, and the refresh-trends cron job.
 */
export const SUPPORTED_REGIONS = ["KR", "US", "JP"] as const;

export type SupportedRegion = (typeof SUPPORTED_REGIONS)[number];

export const DEFAULT_REGION: SupportedRegion = "KR";

export function isSupportedRegion(value: string): value is SupportedRegion {
  return (SUPPORTED_REGIONS as readonly string[]).includes(value);
}

/**
 * Normalizes an arbitrary region query param into a SupportedRegion.
 * Unknown/missing/malformed input falls back to DEFAULT_REGION rather than
 * erroring, matching this API's existing "always respond" behavior.
 */
export function normalizeRegion(value: string | null | undefined): SupportedRegion {
  const upper = (value ?? "").trim().toUpperCase();
  return isSupportedRegion(upper) ? upper : DEFAULT_REGION;
}
