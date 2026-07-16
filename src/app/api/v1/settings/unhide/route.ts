import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { db } from "@/db";
import { userHiddenBooks } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/** POST /api/v1/settings/unhide — { bookId } (web unhideBook action). */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body || typeof body.bookId !== "string") return jsonError("bookId is required.", 400);

  await db.delete(userHiddenBooks).where(and(
    eq(userHiddenBooks.userId, user.userId),
    eq(userHiddenBooks.bookId, body.bookId),
  ));
  return jsonOk({});
}
