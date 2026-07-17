/**
 * Canonical display order for content categories — the SAME everywhere a
 * category list renders (book page What's Inside, settings Content Comfort
 * Zone on web AND the /api/v1/settings payload the iOS app renders verbatim).
 * Sexual content leads per the 2026-07-15 book-page decision; settings
 * matching it was requested 2026-07-17.
 */
export const CONTENT_CATEGORY_ORDER = [
  "romance_sex",
  "violence_gore",
  "profanity_language",
  "substance_use",
  "lgbtqia_representation",
  "religious_content",
  "magic_witchcraft",
  "occult_demonology",
  "political_ideological",
  "self_harm_suicide",
  "abuse_suffering",
  "other",
];

/** Sort-comparator on a `key` field; unknown keys sink to the end. */
export function byContentCategoryOrder<T extends { key: string }>(a: T, b: T): number {
  const ai = CONTENT_CATEGORY_ORDER.indexOf(a.key);
  const bi = CONTENT_CATEGORY_ORDER.indexOf(b.key);
  return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
}
