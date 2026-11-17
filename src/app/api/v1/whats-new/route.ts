import { jsonOk } from "@/lib/api/http";
import { whatsNewForBuild } from "@/lib/whats-new";

/**
 * GET /api/v1/whats-new?build=<n>
 *
 * The "What's New" note the iOS app shows once after an update: the newest
 * note at or below the caller's build, or `note: null` when there is none
 * (unknown, missing or malformed build included — the app then shows nothing).
 *
 * Unauthenticated and read-only, like /api/v1/app-version: it returns release
 * notes and nothing about any account. Content lives in src/lib/whats-new.ts.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("build") ?? "";
  const build = /^\d{1,6}$/.test(raw) ? Number.parseInt(raw, 10) : 0;
  return jsonOk({ note: whatsNewForBuild(build) });
}
