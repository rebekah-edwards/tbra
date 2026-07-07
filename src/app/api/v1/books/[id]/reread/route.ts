import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { addRereadSessionFor } from "@/lib/actions/reading-session";
import { resolveBook } from "@/lib/queries/books";

/**
 * POST /api/v1/books/[id]/reread  { startedAt?, completionDate? }
 * Adds a completed re-read session with the next read number.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const body = (await parseJsonBody(req)) ?? {};
  await addRereadSessionFor(user.userId, resolved.book.id, {
    startedAt: typeof body.startedAt === "string" ? body.startedAt : undefined,
    completionDate: typeof body.completionDate === "string" ? body.completionDate : null,
  });
  return jsonOk({ added: true });
}
