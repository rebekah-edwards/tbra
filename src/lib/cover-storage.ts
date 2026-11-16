import { mkdir, writeFile } from "fs/promises";
import path from "path";

/**
 * The ONE place an uploaded cover file is persisted.
 *
 * Vercel Functions have a read-only, ephemeral filesystem — writing under
 * `public/uploads/` throws in production, and even a write that succeeded
 * would vanish with the instance. So whenever a Blob token is present the
 * file goes to Vercel Blob and the stored URL is absolute. Only a machine
 * with no token (plain local dev) falls back to disk.
 *
 * Three callers used to carry their own copy of this branch and two of them
 * had drifted to filesystem-only (admin cover upload silently failed on
 * production, 2026-11-03). Do not inline this again — import it.
 */

/** MIME type → file extension for the image types a cover may be. */
const COVER_MIME_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export const COVER_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;

/**
 * Validate an admin cover upload. Returns the file extension to store it
 * under, or a human-readable error.
 */
export function validateCoverUpload(
  file: File | null,
): { ok: true; file: File; ext: string } | { ok: false; error: string } {
  if (!file || file.size === 0) return { ok: false, error: "No file provided" };
  if (file.size > COVER_UPLOAD_MAX_BYTES) return { ok: false, error: "File too large (max 2MB)" };
  const ext = COVER_MIME_EXT[file.type];
  if (!ext) return { ok: false, error: "Invalid file type (JPG, PNG, WebP only)" };
  return { ok: true, file, ext };
}

/**
 * Persist a cover image and return the URL to store in
 * `books.cover_image_url`. `ext` must already be validated by the caller
 * (no dots, no path separators).
 */
export async function storeCoverFile(file: File, ext: string): Promise<string> {
  // Timestamp + random suffix: two uploads in the same millisecond must not
  // collide (Blob rejects a duplicate pathname; disk would overwrite).
  const basename = `cover-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(`covers/${basename}`, file, {
      access: "public",
      contentType: file.type || undefined,
    });
    return blob.url;
  }

  // Local dev without a Blob token: save under public/ so Next serves it.
  const uploadDir = path.join(process.cwd(), "public", "uploads", "covers");
  await mkdir(uploadDir, { recursive: true });
  await writeFile(path.join(uploadDir, basename), Buffer.from(await file.arrayBuffer()));
  return `/uploads/covers/${basename}`;
}
