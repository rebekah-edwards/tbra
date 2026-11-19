import { getApiUser, hasPremiumAccess } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getMissingBookMetadata } from "@/lib/queries/missing-book-metadata";

/**
 * GET /api/v1/goals/missing?year=2026 — Based Readers.
 * → { year, pages: MissingMetaBook[], audio: MissingMetaBook[] }
 * The reader's year of reads (plus books in progress) whose catalog row lacks
 * a page count / audio length; ownPages / ownMinutes are their own entries.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);
  if (!hasPremiumAccess(user)) return jsonError("Custom goals are a Based Reader feature.", 403);
  const currentYear = new Date().getFullYear();
  const y = Number(new URL(req.url).searchParams.get("year"));
  const year = Number.isInteger(y) && y > 1900 && y <= currentYear ? y : currentYear;
  return jsonOk({ year, ...(await getMissingBookMetadata(user.userId, year)) });
}
