import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { resolveBook } from "@/lib/queries/books";
import { getUserOwnedEditions } from "@/lib/queries/editions";
import { importEdition, setOwnedEditionFor, removeOwnedEditionFor } from "@/lib/actions/editions";
import { fetchWorkEditions, type OLEdition } from "@/lib/openlibrary";

/**
 * GET /api/v1/books/[id]/editions?offset=0
 * OL editions for the book's work (same source as the web edition
 * picker — OpenLibrary ONLY, the known limitation) + the user's current
 * per-format selections.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const book = resolved.book;

  if (!book.openLibraryKey) {
    return jsonOk({ entries: [], size: 0, selections: [] });
  }

  const url = new URL(req.url);
  const offset = parseInt(url.searchParams.get("offset") ?? "0", 10) || 0;

  const [editions, selections] = await Promise.all([
    fetchWorkEditions(book.openLibraryKey, 50, offset),
    getUserOwnedEditions(user.userId, book.id),
  ]);

  return jsonOk({
    entries: editions.entries,
    size: editions.size,
    selections,
  });
}

/**
 * POST /api/v1/books/[id]/editions — { edition: OLEdition, format }
 * Imports the OL edition into the local cache and marks it owned for
 * the format (importEdition + setOwnedEditionFor, exactly the web flow).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const body = await parseJsonBody(req);
  const edition = body?.edition as OLEdition | undefined;
  const format = typeof body?.format === "string" ? body.format : null;
  if (!edition?.key || !format) return jsonError("edition and format required.", 400);

  const editionId = await importEdition(resolved.book.id, edition);
  await setOwnedEditionFor(user.userId, resolved.book.id, editionId, format);
  return jsonOk({ editionId });
}

/** DELETE /api/v1/books/[id]/editions — { editionId, format } */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  const body = await parseJsonBody(req);
  const editionId = typeof body?.editionId === "string" ? body.editionId : null;
  const format = typeof body?.format === "string" ? body.format : null;
  if (!editionId || !format) return jsonError("editionId and format required.", 400);

  await removeOwnedEditionFor(user.userId, resolved.book.id, editionId, format);
  return jsonOk({ removed: true });
}
