import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { books } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiAdmin } from "@/lib/api/admin";
import { resolveBook } from "@/lib/queries/books";

// Mirrors actions/books.ts updateBookFields — the same 13 editable fields
// the web Admin Edit panel exposes.
const STRING_FIELDS = ["title", "publicationDate", "publisher", "language", "isbn13", "isbn10", "asin", "description", "summary"] as const;
const NUMBER_FIELDS = ["publicationYear", "pages", "audioLengthMinutes"] as const;

/** GET — current values of every editable field (the panel's data source;
 *  the v1 book payload doesn't carry publisher/language/isbn10/date). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);
  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const b = resolved.book;
  return jsonOk({
    fields: {
      title: b.title,
      publicationYear: b.publicationYear,
      publicationDate: b.publicationDate,
      pages: b.pages,
      audioLengthMinutes: b.audioLengthMinutes,
      publisher: b.publisher,
      language: b.language,
      isbn13: b.isbn13,
      isbn10: b.isbn10,
      asin: b.asin,
      isFiction: b.isFiction,
      description: b.description,
      summary: b.summary,
    },
  });
}

/**
 * POST /api/v1/admin/books/[id]/fields — { fields: { title?, pages?, … } }
 * Native Admin Edit panel save. Unlike the web action this ALWAYS bumps
 * updated_at, so the edit rides the nightly live↔local sync.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);

  let body: { fields?: Record<string, unknown> };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid body.", 400);
  }
  const fields = body.fields ?? {};

  const updateSet: Record<string, unknown> = {};
  for (const key of STRING_FIELDS) {
    if (key in fields) {
      const v = fields[key];
      if (v !== null && typeof v !== "string") return jsonError(`${key} must be a string.`, 400);
      updateSet[key] = v === "" ? null : v;
    }
  }
  for (const key of NUMBER_FIELDS) {
    if (key in fields) {
      const v = fields[key];
      if (v !== null && typeof v !== "number") return jsonError(`${key} must be a number.`, 400);
      updateSet[key] = v;
    }
  }
  if ("isFiction" in fields) {
    if (typeof fields.isFiction !== "boolean") return jsonError("isFiction must be a boolean.", 400);
    updateSet.isFiction = fields.isFiction;
  }

  if (Object.keys(updateSet).length === 0) return jsonError("No fields to update.", 400);
  updateSet.updatedAt = new Date().toISOString();

  await db.update(books).set(updateSet).where(eq(books.id, resolved.book.id));
  return jsonOk({});
}
