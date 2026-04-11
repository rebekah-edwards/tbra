import { NextResponse } from "next/server";

/**
 * Vercel Cron job — runs every 5 minutes to keep serverless functions warm.
 * Prevents cold starts on critical user-facing routes.
 *
 * Cold starts on Vercel + Turso can take 5-47 seconds.
 * This endpoint pings the home page and search to keep their
 * function instances alive.
 */
export async function GET(request: Request) {
  // Verify this is a Vercel Cron invocation (not a random request)
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    // Allow without auth in development, but in production require the secret
    if (process.env.NODE_ENV === "production" && process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || "https://thebasedreader.app";

  try {
    // Warm the home page (heaviest route — recommendations engine)
    await fetch(baseUrl, {
      headers: { "x-warmup": "true" },
      signal: AbortSignal.timeout(10000),
    }).catch(() => {});

    // Warm the nav search endpoint
    await fetch(`${baseUrl}/api/search?q=the`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    // Warm the full search endpoint (used by /search page)
    await fetch(`${baseUrl}/api/search/full?q=the`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    return NextResponse.json({ ok: true, warmed: ["home", "search", "search-full"] });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
