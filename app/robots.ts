import type { MetadataRoute } from "next";

/**
 * Everything in HireOS sits behind a sign-in or is a per-visitor sandbox, so nothing is
 * worth indexing. Crawlers are asked to stay out of the whole site.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
