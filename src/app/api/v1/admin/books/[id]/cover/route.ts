import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { books } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireApiAdmin } from "@/lib/api/admin";
import { resolveBook } from "@/lib/queries/books";

// Mirrors the URL sanity checks in actions/books.ts setBookCover — reject
// obvious web-page URLs so a pasted Amazon PRODUCT link fails loudly.
function validateCoverUrl(coverUrl: string): string | null {
  try {
    const parsed = new URL(coverUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) return "URL must be http or https";
    const lowerPath = parsed.pathname.toLowerCase();
    const lowerHost = parsed.hostname.toLowerCase();
    const isKnownImageHost =
      lowerHost.includes("covers.openlibrary.org") ||
      lowerHost.includes("books.google.com") ||
      lowerHost.includes("images-na.ssl-images-amazon.com") ||
      lowerHost.includes("m.media-amazon.com") ||
      lowerHost.includes("images.isbndb.com") ||
      lowerHost.includes("i.imgur.com");
    const hasImageExtension = /\.(jpe?g|png|webp|gif|avif)(\?.*)?$/i.test(lowerPath);
    if (lowerHost.includes("amazon.com") && lowerPath.includes("/dp/")) {
      return "That's an Amazon product page URL, not an image. Copy the image address instead.";
    }
    if (!isKnownImageHost && !hasImageExtension) {
      return "URL doesn't appear to be an image (should end in .jpg, .png, .webp…).";
    }
    return null;
  } catch {
    return "Invalid URL";
  }
}

/**
 * POST /api/v1/admin/books/[id]/cover — the native cover picker's save.
 *
 * Bodies:
 *   JSON { url: string | null }            — set/remove the main cover
 *   JSON { audiobookUrl: string | null }   — set/clear the audiobook square
 *   multipart form, field "cover"          — upload an image file
 *
 * Semantics mirror actions/books.ts (setBookCover / setAudiobookCover /
 * uploadBookCover): manual covers get cover_source='manual' + verified;
 * removal parks the book on /admin/covers via 'admin-removed'. Every branch
 * bumps updated_at — that's what carries the change across the nightly
 * live↔local sync (the Remarkably Bright Creatures lesson, 2026-07-11).
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);

  const { id } = await ctx.params;
  const resolved = await resolveBook(id);
  if (!resolved) return jsonError("Book not found.", 404);
  const bookId = resolved.book.id;

  const contentType = req.headers.get("content-type") ?? "";

  // ── Upload branch (multipart) ──
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("cover") as File | null;
    if (!file || file.size === 0) return jsonError("No file provided.", 400);
    if (file.size > 2 * 1024 * 1024) return jsonError("File too large (max 2MB).", 400);
    const validTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!validTypes.includes(file.type)) return jsonError("Invalid file type (JPG, PNG, WebP only).", 400);

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const filename = `cover-${Date.now()}.${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", "covers");
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, filename), Buffer.from(await file.arrayBuffer()));

    const url = `/uploads/covers/${filename}`;
    await db.update(books).set({
      coverImageUrl: url,
      coverSource: "manual",
      coverVerified: true,
      updatedAt: new Date().toISOString(),
    }).where(eq(books.id, bookId));
    return jsonOk({ url });
  }

  // ── JSON branches ──
  let body: { url?: string | null; audiobookUrl?: string | null };
  try {
    body = await req.json();
  } catch {
    return jsonError("Invalid body.", 400);
  }

  if ("audiobookUrl" in body) {
    const url = body.audiobookUrl || null;
    if (url) {
      try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) return jsonError("URL must be http or https.", 400);
      } catch {
        return jsonError("Invalid URL.", 400);
      }
    }
    await db.update(books)
      .set({ audiobookCoverUrl: url, updatedAt: new Date().toISOString() })
      .where(eq(books.id, bookId));
    return jsonOk({});
  }

  const url = body.url || null;
  if (url) {
    const err = validateCoverUrl(url);
    if (err) return jsonError(err, 400);
  }
  await db.update(books)
    .set(
      url
        ? { coverImageUrl: url, coverSource: "manual", coverVerified: true, updatedAt: new Date().toISOString() }
        : { coverImageUrl: null, coverSource: "admin-removed", coverVerified: false, updatedAt: new Date().toISOString() },
    )
    .where(eq(books.id, bookId));
  return jsonOk({});
}
