import type { MetadataRoute } from "next";
import { getSiteUrl } from "@/lib/siteUrl";
// pr test!! feature robots

const SITE_URL = getSiteUrl();

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api/", "/auth/"],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
