import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody, asString } from "@/lib/api/http";
import { addReadingNoteFor } from "@/lib/mutations/reading-notes";

/**
 * POST /api/v1/reading-notes
 * { bookId, noteText, pageNumber?, percentComplete?, mood?, pace?, buddyReadId? }
 * The Track Progress sheet — identical validation + writes to the web action.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body) return jsonError("Invalid JSON body.", 400);

  const result = await addReadingNoteFor(user.userId, {
    bookId: asString(body.bookId) ?? "",
    noteText: asString(body.noteText) ?? "",
    pageNumber: typeof body.pageNumber === "number" ? Math.trunc(body.pageNumber) : null,
    percentComplete: typeof body.percentComplete === "number" ? Math.trunc(body.percentComplete) : null,
    mood: asString(body.mood),
    pace: asString(body.pace),
    buddyReadId: asString(body.buddyReadId),
  });

  if (!result.success) return jsonError(result.error ?? "Could not save note.", 400);
  return jsonOk({ saved: true });
}
