import { jsonOk } from "@/lib/api/http";

/**
 * GET /api/v1/app-version
 *
 * The minimum iOS build the app will run. TestFlight cannot force an update —
 * testers get a notification and an Update button, and each of them controls
 * their own "Automatic Updates" toggle — so a tester can sit on a build with a
 * known-broken flow indefinitely. That happened through builds 1-7 with the
 * profile-blank and finish-stuck-in-pending bugs.
 *
 * DELIBERATELY UNAUTHENTICATED: the gate has to work for someone who cannot
 * get past the login screen on a broken build, which is exactly the population
 * most likely to need it. It exposes nothing but two integers.
 *
 * To raise the floor: set IOS_MIN_BUILD in the Vercel env and redeploy. The
 * default of 0 means NO gate — a missing or malformed value must never lock
 * anyone out, so every failure path here degrades to "allow".
 */
export async function GET() {
  const parse = (v: string | undefined) => {
    const n = Number.parseInt(v ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };

  return jsonOk({
    // Below this build, the app shows a blocking update screen.
    minBuild: parse(process.env.IOS_MIN_BUILD),
    // Informational: the newest build available, for a soft "update available"
    // nudge later. 0 = unknown.
    latestBuild: parse(process.env.IOS_LATEST_BUILD),
    // Optional override for the blocking screen's explanation.
    message: process.env.IOS_UPDATE_MESSAGE || null,
  });
}
