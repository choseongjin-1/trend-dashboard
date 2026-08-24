/**
 * Fixed, extensible list of regions the ingestion pipeline supports.
 * Add a new ISO 3166-1 alpha-2 code here (and a label below) to bring a
 * region online across /api/trends, /api/trends/history, the
 * refresh-trends cron job, and the frontend's region selector.
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

/** Display label for a region code, for UI use (region selectors, etc.). */
const REGION_LABELS: Record<SupportedRegion, string> = {
  KR: "대한민국",
  US: "United States",
  JP: "日本",
};

export interface Region {
  code: SupportedRegion;
  label: string;
}

/** SUPPORTED_REGIONS paired with display labels, in the same order. */
export const REGIONS: Region[] = SUPPORTED_REGIONS.map((code) => ({
  code,
  label: REGION_LABELS[code],
}));
