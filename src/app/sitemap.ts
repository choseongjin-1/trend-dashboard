import type { MetadataRoute } from "next";
import { REGIONS } from "@/lib/trends/regions";
import { getSiteUrl } from "@/lib/siteUrl";

const SITE_URL = getSiteUrl();

/**
 * The home route serves different content per `?region=` (KR/US/JP ranking
 * boards), so each region gets its own sitemap entry rather than just the
 * bare "/" — same reasoning as the region tabs themselves being real,
 * crawlable URL state (see HomeClient.tsx). Rankings refresh on a cron, so
 * "hourly" reflects actual cadence rather than an arbitrary default.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return [
    {
      url: SITE_URL,
      lastModified,
      changeFrequency: "hourly",
      priority: 1,
    },
    ...REGIONS.map((region) => ({
      url: `${SITE_URL}/?region=${region.code}`,
      lastModified,
      changeFrequency: "hourly" as const,
      priority: 0.8,
    })),
    {
      url: `${SITE_URL}/pricing`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.5,
    },
  ];
}
