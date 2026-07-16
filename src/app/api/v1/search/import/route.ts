import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { importFromISBNdbAndReturn } from "@/lib/actions/books";
import { db } from "@/db";
import { books } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * POST /api/v1/search/import — imports an ISBNdb external search result
 * into the catalog (minimal row + SEO slug + background enrichment, the
 * exact web setBookStateWithImport path) and returns the book id/slug.
 * The client then sets reading state via the normal endpoint.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  if (!body || typeof body.isbn !== "string" || typeof body.title !== "string") {
    return jsonError("isbn and title required.", 400);
  }

  const bookId = await importFromISBNdbAndReturn({
    isbn: body.isbn,
    title: body.title,
    authors: Array.isArray(body.authors) ? body.authors.filter((a: unknown): a is string => typeof a === "string") : [],
    coverUrl: typeof body.coverUrl === "string" ? body.coverUrl : null,
    publicationYear: typeof body.publicationYear === "number" ? body.publicationYear : null,
    pages: typeof body.pages === "number" ? body.pages : null,
  });

  if (!bookId) return jsonError("Import failed.", 500);

  const row = await db.select({ slug: books.slug }).from(books).where(eq(books.id, bookId)).get();
  return jsonOk({ bookId, slug: row?.slug ?? null });
}
