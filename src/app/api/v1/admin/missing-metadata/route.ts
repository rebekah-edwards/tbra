import { jsonError, jsonOk } from "@/lib/api/http";
import { requireApiAdmin } from "@/lib/api/admin";
import { getMissingBookMetadata } from "@/lib/queries/missing-book-metadata";

/**
 * GET /api/v1/admin/missing-metadata?year=2026 — admin only.
 * → { year, pages: MissingMetaBook[], audio: MissingMetaBook[] }
 * The books in the admin's own year of reads with no page count (print/ebook
 * reads) or no audio length (audiobook reads). Fixes are saved through
 * POST /api/v1/admin/books/[id]/fields, which writes the catalog row.
 */
export async function GET(req: Request) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);
  const currentYear = new Date().getFullYear();
  const y = Number(new URL(req.url).searchParams.get("year"));
  const year = Number.isInteger(y) && y > 1900 && y <= currentYear ? y : currentYear;
  const missing = await getMissingBookMetadata(admin.userId, year);
  return jsonOk({ year, ...missing });
}
