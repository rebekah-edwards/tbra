import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
      {
        protocol: "https",
        hostname: "static01.nyt.com",
        pathname: "/bestsellers/**",
      },
    ],
  },
};

export default nextConfig;
