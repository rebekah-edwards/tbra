import { buildCoverUrl } from "@/lib/openlibrary";

export interface EditionCoverInfo {
  format: string;
  coverId: number | null;
}

/**
 * Resolve the effective cover URL for a book based on user's edition selections and reading state.
 *
 * Priority:
 * 1. Active reading format edition cover (only when currently_reading or paused)
 * 2. First owned format edition with a cover
 * 3. Any edition with a cover
 * 4. Base cover URL (book.coverImageUrl)
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

  // 0. Admin audiobook cover override (highest priority when audiobook format is active)
  if (audiobookCoverUrl && (activeFormats.includes("audiobook") || ownedFormats.includes("audiobook"))) {
    const isAudiobookActive = isActivelyReading && activeFormats.includes("audiobook");
    const isAudiobookOwned = ownedFormats.includes("audiobook") && ownedFormats.length === 1;
    if (isAudiobookActive || isAudiobookOwned) return audiobookCoverUrl;
  }

  if (editionSelections.length === 0) return baseCoverUrl;

  // 1. Active format override (only during currently_reading / paused)
  if (isActivelyReading && activeFormats.length > 0) {
    for (const fmt of activeFormats) {
      const match = editionSelections.find((e) => e.format === fmt && e.coverId);
      if (match) return buildCoverUrl(match.coverId, size) ?? baseCoverUrl;
    }
  }

  // 2. Owned format editions — prefer first owned format that has an edition with a cover
  for (const fmt of ownedFormats) {
    const match = editionSelections.find((e) => e.format === fmt && e.coverId);
    if (match) return buildCoverUrl(match.coverId, size) ?? baseCoverUrl;
  }

  // 3. Any edition with a cover
  const withCover = editionSelections.find((e) => e.coverId);
  if (withCover) return buildCoverUrl(withCover.coverId, size) ?? baseCoverUrl;

  return baseCoverUrl;
}
