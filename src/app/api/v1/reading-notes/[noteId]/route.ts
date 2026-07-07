import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { readingNotes } from "@/db/schema";
import { and, eq } from "drizzle-orm";

/**
 * PATCH /api/v1/reading-notes/[noteId] — toggle privacy (same write as
 * the web's toggleNotePrivacy; ownership-checked).
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { noteId } = await ctx.params;
  const note = await db
    .select({ id: readingNotes.id, isPrivate: readingNotes.isPrivate })
    .from(readingNotes)
    .where(and(eq(readingNotes.id, noteId), eq(readingNotes.userId, user.userId)))
    .get();
  if (!note) return jsonError("Note not found.", 404);

  await db.update(readingNotes)
    .set({ isPrivate: !note.isPrivate })
    .where(eq(readingNotes.id, noteId));

  return jsonOk({ isPrivate: !note.isPrivate });
}

/** DELETE /api/v1/reading-notes/[noteId] — ownership-checked delete. */
export async function DELETE(req: Request, ctx: { params: Promise<{ noteId: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { noteId } = await ctx.params;
  const note = await db
    .select({ id: readingNotes.id })
    .from(readingNotes)
    .where(and(eq(readingNotes.id, noteId), eq(readingNotes.userId, user.userId)))
    .get();
  if (!note) return jsonError("Note not found.", 404);

  await db.delete(readingNotes).where(eq(readingNotes.id, noteId));
  return jsonOk({ deleted: true });
}
