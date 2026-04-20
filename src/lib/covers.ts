import { buildCoverUrl } from "@/lib/openlibrary";

export interface EditionCoverInfo {
  format: string;
  coverId: number | null;
}

/**
 * Resolve the effective cover URL for a book based on user's edition selections and reading state.
 *
 * Priority:
 * 1. Admin audiobook cover override (when actively listening or audiobook is the only owned format)
 * 2. Owned-edition cover — user explicitly picked an edition with its own cover.
 *    If actively reading, the active format's edition wins; otherwise the first
 *    owned format's edition is used. This matches the user expectation that
 *    "I picked this edition, show me its cover."
 * 3. Base cover URL (book.coverImageUrl) — admin-set cover, used when there's
 *    no owned-edition selection (or the selected edition has no coverId).
 */
export function getEffectiveCoverUrl(params: {
  baseCoverUrl: string | null;
  editionSelections: EditionCoverInfo[];
  activeFormats: string[];
  ownedFormats: string[];
  isActivelyReading: boolean;
  size?: "S" | "M" | "L";
  audiobookCoverUrl?: string | null;
}): string | null {
  const { baseCoverUrl, editionSelections, activeFormats, ownedFormats, isActivelyReading, size = "M", audiobookCoverUrl } = params;

  // 1. Admin audiobook cover override (highest priority when audiobook format is active)
  if (audiobookCoverUrl && (activeFormats.includes("audiobook") || ownedFormats.includes("audiobook"))) {
    const isAudiobookActive = isActivelyReading && activeFormats.includes("audiobook");
    const isAudiobookOwned = ownedFormats.includes("audiobook") && ownedFormats.length === 1;
    if (isAudiobookActive || isAudiobookOwned) return audiobookCoverUrl;
  }

  // 2. Owned-edition cover: active-reading format wins when available, otherwise
  //    use the first owned format that has an edition with a coverId.
  if (editionSelections.length > 0) {
    const priorityFormats = isActivelyReading && activeFormats.length > 0
      ? [...activeFormats, ...ownedFormats.filter((f) => !activeFormats.includes(f))]
      : ownedFormats;
    for (const fmt of priorityFormats) {
      const match = editionSelections.find((e) => e.format === fmt && e.coverId);
      if (match) return buildCoverUrl(match.coverId, size) ?? baseCoverUrl;
    }
  }

  // 3. Base cover (admin-set or enrichment-set) — fallback when no owned edition
  //    has a usable cover.
  return baseCoverUrl;
}
