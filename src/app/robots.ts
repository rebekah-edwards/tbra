import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin/",
          "/api/",
          "/settings",
          "/import",
          "/onboarding",
          "/profile/edit",
          "/profile/journal",
          "/profile/reviews",
          "/search/add",
        ],
      },
    ],
    sitemap: "https://thebasedreader.app/sitemap.xml",
  };
}
