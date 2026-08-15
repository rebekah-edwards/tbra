import { getApiUser } from "@/lib/auth";
import { jsonError, jsonOk, parseJsonBody } from "@/lib/api/http";
import { parseReviewImport, ParseImportError } from "@/lib/reviews/parse-import";

/**
 * POST /api/v1/reviews/parse-import
 * Body: { text: string, isFiction?: boolean }
 *
 * Takes text OCR'd ON DEVICE from a Goodreads / Fable / StoryGraph review
 * screenshot and returns it mapped onto the tbr*a review model, ready to
 * pre-fill the review wizard.
 *
 * Text, not the image: on-device Vision OCR is free, fast, private and works
 * offline, and sending the extracted text costs a fraction of the tokens an
 * image would. The one thing OCR cannot read is a row of star GLYPHS with no
 * number next to it (Goodreads and Fable both render stars that way) — in
 * that case the response comes back with ratingSource "glyph" and the client
 * follows up with a cropped image of just the star row.
 *
 * This NEVER saves anything. The parsed values pre-fill the wizard and the
 * reader confirms them.
 */
export async function POST(req: Request) {
  const user = await getApiUser(req);
  if (!user) return jsonError("Unauthorized.", 401);

  const body = await parseJsonBody(req);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return jsonError("No text supplied.", 400);
  // A whole screenshot's OCR is a few hundred characters; anything far past
  // that is not a review screenshot and shouldn't reach the model.
  if (text.length > 8000) return jsonError("Text too long.", 413);

  const isFiction = body?.isFiction !== false;
  // Title/author let the parser strip the book's own name out of `unmapped`.
  const title = typeof body?.title === "string" ? body.title : undefined;
  const authors = Array.isArray(body?.authors) ? body.authors.map(String) : undefined;

  try {
    const parsed = await parseReviewImport(text, isFiction, { title, authors });
    return jsonOk({ parsed });
  } catch (err) {
    if (err instanceof ParseImportError) {
      // Log the real cause: the user-facing copy is deliberately vague, and
      // without this a 503 is indistinguishable from a timeout in the log.
      console.error(`[parse-import] ${err.code}: ${err.message}`);
      // Distinguish "try again" from "this will never work" for the client.
      const retryable = err.code === "TIMEOUT" || err.code === "API_EXHAUSTED";
      return jsonError(
        retryable
          ? "Couldn't read that right now — try again in a moment."
          : "Couldn't read that screenshot.",
        retryable ? 503 : 422
      );
    }
    throw err;
  }
}
