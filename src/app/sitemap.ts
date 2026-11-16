import type { MetadataRoute } from "next";

const BASE_URL = "https://thebasedreader.app";

/**
 * Static sitemap — only pages that don't require database queries.
 * Dynamic content (books, authors, series) is served via the API-route
 * sitemaps listed in /sitemap-index.xml.
 *
 * No lastModified/changeFrequency/priority: the old lastModified was the
 * request time (not a real content date) and Google ignores the other two.
 * /signup is not listed because that page is noindexed.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: BASE_URL },
    { url: `${BASE_URL}/discover` },
    { url: `${BASE_URL}/browse` },
    { url: `${BASE_URL}/methodology` },
    { url: `${BASE_URL}/contact` },
  ];
}
