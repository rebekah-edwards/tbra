import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { getUserBooks } from "@/lib/queries/reading-state";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * GET /api/v1/library
 * Every book in the user's library (states + owned), the same
 * UserBookWithDetails rows the web /library page loads, plus
 * hasContentConflict (a rating exceeds the viewer's comfort zone — drives
 * the ⚠ cover badge and the Flagged sub-filter, same rule the web computes
 * client-side in library-client.tsx). Grouping, sub-filters, and sorting
 * are client-side — identical to the web.
 */
export async function GET(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const books = await getUserBooks(user.userId);

  const conflictRows = await db.all<{ book_id: string }>(sql`
    SELECT DISTINCT r.book_id FROM book_category_ratings r
    JOIN taxonomy_categories tc ON tc.id = r.category_id
    JOIN user_content_preferences p ON p.category_id = tc.key AND p.user_id = ${user.userId}
    WHERE p.max_tolerance < 4 AND r.intensity > p.max_tolerance
  `);
  const conflictIds = new Set(conflictRows.map((r) => r.book_id));

  return jsonOk({
    books: books.map((b) => ({ ...b, hasContentConflict: conflictIds.has(b.id) })),
  });
}
