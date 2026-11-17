import type { NextConfig } from "next";

// Crawlers that get metadata (title, canonical, robots) in the real <head>
// instead of streamed into <body>. Setting htmlLimitedBots REPLACES Next's
// built-in list, so this is that list (next/dist/shared/lib/router/utils/
// html-bots.js, 16.2.1) plus Googlebot — which Next leaves out because it
// renders JS. Found 2026-11-16: every book/series/author page served Googlebot
// its canonical ~40KB into the body, after </head>.
const HTML_LIMITED_BOTS =
  /Googlebot|[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight/i;

const nextConfig: NextConfig = {
  htmlLimitedBots: HTML_LIMITED_BOTS,
  // Dev-only: the native app's webviews (cover picker, admin) reach this dev
  // server via the Mac's Tailscale IP. Without this, Next blocks the /_next
  // assets cross-origin — pages render (SSR) but NEVER hydrate, so nothing
  // is clickable and ?editCover=1 silently no-ops (found 2026-07-13).
  allowedDevOrigins: ["100.84.95.103"],
  typescript: {
    // Type checking done locally; skip on Vercel to avoid memory/timeout issues
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-XSS-Protection", value: "1; mode=block" },
        ],
      },
      {
        // Universal links: Apple's CDN requires application/json on the AASA
        // file (the extensionless static file would otherwise serve as
        // octet-stream).
        source: "/.well-known/apple-app-site-association",
        headers: [
          { key: "Content-Type", value: "application/json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
      {
        source: "/book/:slug*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=300" },
        ],
      },
      {
        source: "/series/:slug*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=60, stale-while-revalidate=300" },
        ],
      },
      {
        source: "/author/:slug*",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=120, stale-while-revalidate=600" },
        ],
      },
      {
        source: "/methodology",
        headers: [
          { key: "Cache-Control", value: "public, s-maxage=3600, stale-while-revalidate=86400" },
        ],
      },
    ];
  },
  experimental: {
    // Server Actions reject request bodies over 1 MB by default — BEFORE the
    // action runs, so its own size check never gets to answer. The admin
    // cover upload (uploadBookCover) advertises and validates 2 MB; without
    // this, any cover between 1 and 2 MB failed with an opaque 413.
    serverActions: {
      bodySizeLimit: "3mb",
    },
    viewTransition: true,
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "covers.openlibrary.org",
        pathname: "/b/**",
      },
      {
        protocol: "https",
        hostname: "books.google.com",
        pathname: "/books/content/**",
      },
      {
        protocol: "https",
        hostname: "aproposbooks.net",
        pathname: "/wp-content/uploads/**",
      },
      {
        protocol: "https",
        hostname: "images-na.ssl-images-amazon.com",
        pathname: "/images/**",
      },
      {
        protocol: "https",
        hostname: "m.media-amazon.com",
        pathname: "/images/**",
      },
      {
        protocol: "https",
        hostname: "i.gr-assets.com",
        pathname: "/images/**",
      },
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
      {
        protocol: "https",
        hostname: "images.isbndb.com",
        pathname: "/covers/**",
      },
      // Covers pasted by hand in /admin/covers come from wherever the
      // publisher or retailer hosts them. A host missing from this list makes
      // next/image THROW in development (the whole page falls to the error
      // boundary) and serve a broken image in production — six books had one
      // on 2026-11-16, including a book on the owner's Up Next.
      { protocol: "https", hostname: "upload.wikimedia.org" },
      { protocol: "https", hostname: "mpd-biblio-covers.imgix.net" },
      { protocol: "https", hostname: "images.booksense.com" },
      { protocol: "https", hostname: "g.christianbook.com" },
      { protocol: "https", hostname: "bakerbookhouse.com" },
      {
        protocol: "https",
        hostname: "static01.nyt.com",
        pathname: "/bestsellers/**",
      },
      {
        protocol: "https",
        hostname: "lh3.googleusercontent.com",
      },
    ],
  },
};

export default nextConfig;
