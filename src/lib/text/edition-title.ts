/**
 * Edition-title decoration: the single source of truth.
 *
 * Publishers ship the same work as "<Title> Paperback Deluxe Limited Edition",
 * "<Title> Collector's Edition", "<Title> 10th Anniversary Edition" … and every
 * metadata source treats each as a distinct record with its own ISBN. Rebekah's
 * standing rule is that these are EDITIONS of the canon book, never separate
 * `books` rows.
 *
 * This logic first landed inline in `scripts/process-reports.ts` (2026-08-14),
 * where it fixed edition-variant reports dying as "no sibling found". It lives
 * here now because the report triage was the LAST line of defence, not the
 * first: seven ingestion paths each carried their own title normalizer and none
 * of them stripped decoration, so decorated rows were still being created
 * nightly faster than triage could merge them. Every dedup path imports from
 * this module so the rules can never drift apart again.
 *
 * Only edition/printing decoration is stripped. Anything that changes WHICH
 * work it is — "Collection", "Box Set", "Omnibus", volume numbers — is
 * deliberately NOT stripped: those really are different products and merging
 * them would destroy real distinctions. "Shatter Me: the Six-Novel Collection"
 * is not an edition of "Shatter Me".
 */

/** Lowercase, de-accent, and reduce to `[a-z0-9 ]` words. */
export function normalizeTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Author names collapse to letters only — "J.R.R. Tolkien" === "JRR Tolkien". */
export function normalizeAuthor(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z]/g, "");
}

const EDITION_SUFFIX = new RegExp(
  String.raw`\s+(?:` +
    [
      // qualifiers that may stack in any order before the word "edition"
      String.raw`(?:the\s+)?(?:\d+(?:st|nd|rd|th)\s+)?anniversary`,
      String.raw`paperback`,
      String.raw`hardcover|hardback`,
      String.raw`mass market`,
      String.raw`large (?:print|type)`,
      String.raw`deluxe`,
      String.raw`limited`,
      String.raw`collectors?`,
      String.raw`collector s`, // normalizeTitle turns "Collector's" into "collector s"
      String.raw`special`,
      String.raw`exclusive`,
      String.raw`signed`,
      String.raw`illustrated`,
      String.raw`annotated`,
      String.raw`unabridged|abridged`,
      String.raw`revised`,
      String.raw`expanded`,
      String.raw`international|intl`,
      String.raw`(?:movie|media|tv|film)\s+tie\s*in`,
      String.raw`reissue`,
      // ONLY the first ordinal, never 2nd and above. "1st" marks a PRINTING —
      // a collector's distinction over the same text ("Signed 1st", "World's
      // Fair 1ST Edition"). Higher ordinals mark REVISED CONTENT, and annual
      // reference works prove it: audited against the full catalog on
      // 2026-08-15, a general `\d+(?:st|nd|rd|th)` created 6 new merge groups,
      // of which two were wrong and destructive — it folded the 10th and 14th
      // Overstreet Arrowheads guides together, and collapsed FIVE distinct
      // Overstreet Comic Book Price Guides (27th/32nd/33rd/34th/36th) into one
      // entry. Restricted to `1st` the same audit yields 3 groups, all correct.
      // Re-run scripts/audit-edition-suffix-widening.ts before widening again.
      String.raw`1st`,
      String.raw`edition`,
    ].join("|") +
    String.raw`)`,
  "g",
);

/**
 * Strip trailing edition decoration from an ALREADY-normalized title.
 * "unravel me paperback deluxe limited edition" -> "unravel me"
 *
 * Returns the input unchanged if stripping would leave nothing, so a book
 * actually titled "Deluxe Edition" keeps its title rather than collapsing to "".
 */
export function stripEditionSuffix(normalized: string): string {
  let prev = normalized;
  // Chip qualifiers off the END only, repeatedly, so word order doesn't matter
  // and a leading "Deluxe Dungeons" style title is never touched.
  for (;;) {
    const next = prev.replace(new RegExp(`(?:${EDITION_SUFFIX.source})$`), "").trim();
    if (next === prev) break;
    prev = next;
  }
  return prev.length > 0 ? prev : normalized;
}

/**
 * The key two rows must share to be the same work: normalized + decoration
 * stripped, spaces removed. This is what every ingestion path compares on.
 */
export function editionMatchKey(title: string): string {
  return stripEditionSuffix(normalizeTitle(title)).replace(/ /g, "");
}

/** True when the title carries edition decoration (i.e. it is NOT the canon form). */
export function isDecoratedTitle(title: string): boolean {
  const n = normalizeTitle(title);
  return stripEditionSuffix(n) !== n;
}

/**
 * The raw title with its edition decoration removed, preserving original
 * casing and punctuation: "Y The Last Man - Deluxe Edition" -> "Y The Last Man".
 * Returns the input unchanged when there is no decoration to strip.
 *
 * Counterpart to stripEditionSuffix(), which only works on normalized
 * (lowercased, punctuation-stripped) titles and so cannot produce a title fit
 * to display. Used when renaming a book that has no undecorated sibling to
 * merge into.
 */
export function stripEditionSuffixRaw(title: string): string {
  const label = extractEditionLabel(title);
  if (!label) return title;

  const rawWords = title.trim().split(/\s+/);
  const labelWordCount = label.trim().split(/\s+/).length;

  // extractEditionLabel already trimmed bracketing punctuation off the label,
  // so match on word count from the end rather than string length.
  for (let k = labelWordCount; k <= rawWords.length - 1; k++) {
    const kept = rawWords.slice(0, rawWords.length - k).join(" ");
    if (normalizeTitle(kept) === stripEditionSuffix(normalizeTitle(title))) {
      // Drop the separator the decoration hung off: "Night Land (" -> "Night Land",
      // "Prayer -" -> "Prayer", "I Am Malala:" -> "I Am Malala".
      let cleaned = kept.replace(/[\s:,\-–—([]+$/, "").trim();
      // The decoration may have sat INSIDE a trailing parenthetical whose opening
      // bracket is still in `kept` ("… World (Young Readers" from "… World (Young
      // Readers Edition)"). An unclosed "(" means we sliced into it, so drop the
      // whole parenthetical rather than leaving a dangling fragment.
      const opens = (cleaned.match(/\(/g) ?? []).length;
      const closes = (cleaned.match(/\)/g) ?? []).length;
      if (opens > closes) {
        cleaned = cleaned.slice(0, cleaned.lastIndexOf("(")).replace(/[\s:,\-–—]+$/, "").trim();
      }
      return cleaned || title;
    }
  }
  return title;
}

/**
 * Recover the human-readable decoration from a raw title, for labelling the
 * edition row a merge creates: "Unravel Me Paperback Deluxe Limited Edition"
 * -> "Paperback Deluxe Limited Edition". Returns null for undecorated titles.
 *
 * Works on the RAW title (not the normalized one) so the label keeps its
 * original casing and punctuation for display.
 */
export function extractEditionLabel(title: string): string | null {
  const normalized = normalizeTitle(title);
  const base = stripEditionSuffix(normalized);
  if (base === normalized) return null;

  const dropped = normalized.slice(base.length).trim();
  if (!dropped) return null;

  // Find how many RAW trailing words normalize to exactly the dropped text.
  // Counting normalized words instead would over-slice whenever punctuation
  // splits one raw word into two ("Collector's" -> "collector s"), which eats
  // a real title word and produces a label like "Me Collector's Edition".
  const rawWords = title.trim().split(/\s+/);
  for (let k = 1; k <= rawWords.length - 1; k++) {
    const candidate = rawWords.slice(-k).join(" ");
    if (normalizeTitle(candidate) === dropped) {
      // Trim the punctuation that bracketed the decoration in the raw title,
      // so "(Movie Tie-In)" reads as "Movie Tie-In" and not "Movie Tie-In)".
      return candidate.replace(/^[\s:,\-–—([]+/, "").replace(/[\s)\]]+$/, "").trim() || dropped;
    }
  }
  return dropped;
}
