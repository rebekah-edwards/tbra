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
 * 2. Active reading format edition cover (only when currently_reading or paused that format)
 * 3. Base cover URL (book.coverImageUrl) — admin-set cover ALWAYS wins for browsing
 *
 * Owned-format edition covers are NO LONGER used as a passive override. The base cover
 * (set by enrichment or admin) is authoritative when the user isn't actively reading.
 * This prevents user_owned_editions auto-import from hijacking admin cover updates.
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

  // 2. Active format override (only during currently_reading / paused with that format)
  if (isActivelyReading && activeFormats.length > 0 && editionSelections.length > 0) {
    for (const fmt of activeFormats) {
      const match = editionSelections.find((e) => e.format === fmt && e.coverId);
      if (match) return buildCoverUrl(match.coverId, size) ?? baseCoverUrl;
    }
  }

  // 3. Base cover (admin-set or enrichment-set) — authoritative for all other cases
  return baseCoverUrl;
}
