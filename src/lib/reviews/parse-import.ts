import OpenAI from "openai";
import {
  DIMENSION_TAGS, FICTION_DIMENSIONS, MOOD_KEYS, NONFICTION_DIMENSIONS, PACING,
  type ParsedImport, type ImportSource,
} from "./import-vocab";

/**
 * Maps OCR'd text from a Goodreads / Fable / StoryGraph review screenshot onto
 * the tbr*a review model.
 *
 * The book is NOT identified here — the wizard is always opened for a known
 * book, so this only extracts review CONTENT. That removes the entire
 * title-matching problem and the ambiguity UI that would have come with it.
 *
 * What each source actually gives us (measured against real screenshots,
 * 2026-08-13):
 *  · Goodreads  — glyph stars only (NO number), review text, read dates. No
 *                 dimension ratings, no moods. The rating needs the image pass.
 *  · Fable      — glyph stars, review text, an optional mood emoji, and — on
 *                 the expanded card — per-dimension NUMERIC ratings
 *                 (Characters 4.75, Plot 5.00, Setting 4.25, Writing Style
 *                 4.75) plus tags under each. Richest source by far.
 *  · StoryGraph — a NUMERIC overall ("4.25"), mood/pace pills
 *                 (adventurous / tense / fast-paced) and its Yes/No character
 *                 questions.
 */

// Separate knob from the enrichment model: this one sits in a USER-FACING
// flow where latency is the dominant cost, not analytical depth. Extraction
// from clean OCR text is an easy task — a smaller model is the right default
// if it holds accuracy.
// grok-4.5 (the enrichment model) took 10-22s per screenshot — far too slow
// to sit behind a spinner in the review wizard. The non-reasoning variant does
// the same extraction in 1-2s with equal or better accuracy on the five real
// screenshots, because this is a structured-extraction task, not a reasoning
// one. Override with XAI_IMPORT_MODEL if the snapshot is retired.
const MODEL = process.env.XAI_IMPORT_MODEL || "grok-4.20-0309-non-reasoning";

function buildPrompt(text: string, isFiction: boolean): string {
  const dims = isFiction ? FICTION_DIMENSIONS : NONFICTION_DIMENSIONS;
  const tagLines = dims
    .map((d) => `  ${d}: ${DIMENSION_TAGS[d].join(", ")}`)
    .join("\n");

  return `You convert a book review screenshot (already OCR'd to text) from Goodreads, Fable or StoryGraph into the tbr*a review format.

OCR TEXT:
"""
${text}
"""

Return ONLY a JSON object, no prose, with exactly these keys:

{
  "source": "goodreads" | "fable" | "storygraph" | "unknown",
  "overallRating": number | null,
  "ratingSource": "explicit" | "glyph" | "missing",
  "reviewText": string | null,
  "reviewTextTruncated": boolean,
  "mood": string | null,
  "plotPacing": "slow" | "medium" | "fast" | null,
  "dimensionRatings": { "<dimension>": number },
  "dimensionTags": { "<dimension>": [string] },
  "unmapped": [string]
}

RULES

source — infer from layout cues: "Shelved as:" / "Read from:" => goodreads;
"Created Nw ago" with per-dimension rows (Characters/Plot/Setting/Writing Style) => fable;
mood+pace pills with "Plot or Character Driven:" => storygraph.

overallRating — 0.25 to 5, in QUARTER steps only.
  · If a NUMBER appears next to the stars (e.g. "4.25", "5.00"), use it and set
    ratingSource "explicit".
  · Else, if the text contains star GLYPH characters (★ ☆ ⯨ ½), count the
    filled ones, use that, and set ratingSource "glyph".
  · Else set overallRating null and ratingSource "missing". NEVER infer a
    rating from the tone of the review prose — a wrong star count is worse
    than none, because the user may not notice it before saving.
  · Per-dimension numbers are NOT the overall rating.

reviewText — the reviewer's own prose only. EXCLUDE the book title, author,
star row, dates, shelf names, comment counts, like counts, UI labels
("Your Review", "Edit Review", "Share", "Post"), and any advertisement text
that the OCR picked up. Preserve paragraph breaks and emoji. Set
reviewTextTruncated true only if the source visibly cut it off ("...more",
"See more").

mood — at most ONE key, only when the screenshot genuinely signals it.
Fable prints a mood EMOJI next to the stars; map it when present:
  😌 relieved/content => happy      🥰 => romantic     😢😭 => emotional
  🤯 => mind-blown                  🤔 => contemplative 😨 => frightened
  😡 => angry                       🧐 => curious       😊 => happy
  🤪 => silly                       😳 => shaken        😲 => surprised
  🤓 => informed                    😕 => confused      🙏 => grateful
  ✨ => inspired                    🍃 => nostalgic     🫥 => empty
Emoji inside the review PROSE are not mood markers — only a standalone emoji
in the rating row counts. Otherwise prefer null over a stretch.
Allowed: ${MOOD_KEYS.join(", ")}

plotPacing — only from an explicit pace signal. StoryGraph's "fast-paced" =>
"fast", "medium-paced" => "medium", "slow-paced" => "slow". Allowed: ${PACING.join(", ")}

dimensionRatings — ONLY when the source shows a per-dimension number. Map
Fable's rows: Characters=>characters, Plot=>plot, Setting=>setting,
"Writing Style"=>prose. Values 0.25-5 in quarter steps. Omit dimensions with
no number. Never invent one from the tags.

dimensionTags — map source pills to the CLOSED tbr*a lists below. Use the
EXACT strings, including capitalisation. Map on MEANING, not spelling — these
sources use their own wording for the same idea:
  "likeable" / "loveable" / "Loveable characters: Yes"  => characters "Lovable"
  "relatable"                                            => characters "Relatable"
  "memorable"                                            => characters "Memorable"
  "Strong character development: Yes"                    => characters "Well-developed"
  "gripping/exciting" / "action-packed"                  => plot "Gripping"
  "clever plotting"                                      => plot "Layered"
  "twisty"                                               => plot "Twisty"
  "mystery-packed"                                       => plot "Suspenseful"
A Yes/No question answered "No" or "Complicated" maps to NOTHING — only "Yes"
answers assert a quality.
Tags may ONLY come from explicit pills, labels or attribute rows. NEVER infer
a tag from the review prose: if the reviewer merely writes "it was twisty",
that is their sentence, not a tag they chose, and auto-selecting chips they
never picked puts words in their mouth.
Do NOT force a weak match; anything you are unsure of belongs in unmapped. StoryGraph's mood pills
(adventurous, tense…) are MOODS, not dimension tags — do not map them here.
Allowed tags per dimension:
${tagLines}

unmapped — ONLY review attributes (pills, tags, mood/pace words, attribute
rows) that you could not place, e.g. "setting fits the story", "adventurous",
"Flaws of characters a main focus: Complicated". NEVER put the book title,
author, dates, shelf names, UI labels or like/comment counts here — those are
chrome, not review data. The user sees this list, so it must contain only
things they actually chose. Never invent entries.`;
}

export class ParseImportError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

export async function parseReviewImport(
  text: string,
  isFiction: boolean,
  /** The book the wizard is open for — used to strip its title/author out of
   *  `unmapped`, which the model keeps mistaking for review attributes. */
  book?: { title?: string; authors?: string[] }
): Promise<ParsedImport> {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new ParseImportError("XAI_API_KEY not set", "NO_KEY");

  const client = new OpenAI({ baseURL: "https://api.x.ai/v1", apiKey });
  const prompt = buildPrompt(text, isFiction);

  // Retry transient failures instead of showing them. The xAI account is
  // SHARED with the nightly enrichment lanes (content-ratings runs 4 books in
  // flight), so a user import can collide with them and take a 429 — which
  // surfaced to Rebekah as "couldn't read that right now" on 2026-08-13 even
  // though a burst of 5 sequential calls all succeeded seconds later. A short
  // backoff turns that into a slightly slower success.
  const RETRY_DELAYS_MS = [700, 1800];
  let response;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const controller = new AbortController();
    // 20s per ATTEMPT, not 45s once: the model normally answers in 1-2s, and
    // a single 28s response is worse for the user than a retry.
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      response = await client.chat.completions.create(
        {
          model: MODEL,
          messages: [{ role: "user", content: prompt }],
          // Low temperature: this is an extraction task, not a creative one.
          temperature: 0.1,
          response_format: { type: "json_object" },
        },
        { signal: controller.signal }
      );
      break;
    } catch (err: unknown) {
      lastErr = err;
      const status = (err as { status?: number }).status;
      // A bad key never gets better by waiting.
      if (status === 401) throw new ParseImportError("Grok key invalid", "API_KEY_INVALID");
      const transient =
        status === 429 || status === 402 || status === 403 ||
        (status != null && status >= 500) ||
        (err as Error).name === "AbortError";
      if (!transient || attempt === RETRY_DELAYS_MS.length) break;
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    } finally {
      clearTimeout(timeout);
    }
  }

  if (!response) {
    const status = (lastErr as { status?: number })?.status;
    if (status === 429 || status === 402 || status === 403) {
      throw new ParseImportError(`Grok exhausted (${status}) after retries`, "API_EXHAUSTED");
    }
    if ((lastErr as Error)?.name === "AbortError") {
      throw new ParseImportError("Timed out after retries", "TIMEOUT");
    }
    throw lastErr ?? new ParseImportError("Unknown failure", "UNKNOWN");
  }

  const raw = response.choices[0]?.message?.content ?? "";
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    throw new ParseImportError("Model returned non-JSON", "BAD_JSON");
  }

  return sanitize(obj, isFiction, book);
}

/**
 * Server-side clamp of everything the model returned. The prompt asks for a
 * closed vocabulary but nothing enforces it, and an out-of-vocabulary tag
 * would be accepted by the wizard's UI and then dropped on save — so the
 * filtering has to happen here, not in the client.
 */
export function sanitize(
  obj: Record<string, unknown>,
  isFiction: boolean,
  book?: { title?: string; authors?: string[] }
): ParsedImport {
  const dims: readonly string[] = isFiction ? FICTION_DIMENSIONS : NONFICTION_DIMENSIONS;

  const quarter = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!isFinite(n) || n <= 0) return null;
    const snapped = Math.round(Math.min(n, 5) * 4) / 4;
    return snapped >= 0.25 ? snapped : null;
  };

  const ratings: Record<string, number> = {};
  const rawRatings = (obj.dimensionRatings ?? {}) as Record<string, unknown>;
  for (const d of dims) {
    const v = quarter(rawRatings[d]);
    if (v != null) ratings[d] = v;
  }

  const tags: Record<string, string[]> = {};
  const rawTags = (obj.dimensionTags ?? {}) as Record<string, unknown>;
  for (const d of dims) {
    const allowed = DIMENSION_TAGS[d] ?? [];
    const list = Array.isArray(rawTags[d]) ? (rawTags[d] as unknown[]) : [];
    const kept = list
      .map((t) => String(t))
      // Case-insensitive match, but emit the canonical casing.
      .map((t) => allowed.find((a) => a.toLowerCase() === t.toLowerCase()))
      .filter((t): t is string => !!t);
    if (kept.length) tags[d] = Array.from(new Set(kept));
  }

  const moodRaw = obj.mood == null ? null : String(obj.mood).toLowerCase();
  const mood = (MOOD_KEYS as readonly string[]).includes(moodRaw ?? "") ? moodRaw : null;

  const pacingRaw = obj.plotPacing == null ? null : String(obj.plotPacing).toLowerCase();
  const plotPacing = (PACING as readonly string[]).includes(pacingRaw ?? "")
    ? (pacingRaw as "slow" | "medium" | "fast")
    : null;

  const sourceRaw = String(obj.source ?? "unknown").toLowerCase();
  const source: ImportSource =
    sourceRaw === "goodreads" || sourceRaw === "fable" || sourceRaw === "storygraph"
      ? sourceRaw
      : "unknown";

  // A rating COUNTED from star glyphs is real but lower-confidence than a
  // printed number, and the client uses that difference to decide whether to
  // follow up with the cropped star image. The earlier version overwrote any
  // non-null rating to "explicit", which erased the distinction entirely.
  const ratingSourceRaw = String(obj.ratingSource ?? "missing");
  const overallRating = quarter(obj.overallRating);
  const ratingSource: ParsedImport["ratingSource"] =
    overallRating == null
      ? "missing"
      : ratingSourceRaw === "glyph"
        ? "glyph"
        : "explicit";

  const reviewText =
    typeof obj.reviewText === "string" && obj.reviewText.trim().length > 0
      ? obj.reviewText.trim()
      : null;

  // Goodreads renders no pills or per-dimension rows at all, so any tag
  // "extracted" from a Goodreads screenshot was invented from the review
  // prose. Auto-selecting chips the reviewer never picked would pollute the
  // per-dimension signal the app is built on, and pre-filled chips get saved
  // unread. Dropped here rather than left to prompt compliance — the fast
  // model ignores the instruction roughly half the time.
  const keepTags = source === "goodreads" ? {} : tags;

  return {
    source,
    overallRating,
    ratingSource,
    reviewText,
    reviewTextTruncated: obj.reviewTextTruncated === true,
    mood,
    plotPacing,
    dimensionRatings: ratings,
    dimensionTags: keepTags,
    unmapped: cleanUnmapped(obj.unmapped, book, reviewText),
  };
}

/**
 * `unmapped` is shown to the reader as "we saw these but couldn't map them",
 * so it must only ever contain things they actually chose. The model reliably
 * slips the book title, author and stray UI text in; strip those here.
 */
function cleanUnmapped(
  raw: unknown,
  book: { title?: string; authors?: string[] } | undefined,
  reviewText: string | null
): string[] {
  if (!Array.isArray(raw)) return [];
  const norm = (v: string) => v.toLowerCase().replace(/^by\s+/, "").trim();
  const banned = new Set<string>();
  if (book?.title) banned.add(norm(book.title));
  for (const a of book?.authors ?? []) banned.add(norm(a));

  const prose = (reviewText ?? "").toLowerCase();

  return raw
    .map((u) => String(u).trim())
    .filter((u) => u.length > 0 && u.length <= 60)
    .filter((u) => !banned.has(norm(u)))
    // A "pill" that is simply a sentence lifted out of the review is not an
    // attribute the reviewer selected.
    .filter((u) => !(u.length > 25 && prose.includes(u.toLowerCase())))
    .slice(0, 12);
}
