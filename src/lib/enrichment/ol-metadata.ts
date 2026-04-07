/**
 * Consolidated Open Library metadata fetch.
 * Pulls ISBN, ASIN, publication date/year, publisher, description, genres,
 * editions count, and cover URL from OL — all free, no API costs.
 */
import { fetchOpenLibraryWork, buildCoverUrl, normalizeGenres, findEnglishCover, findIsbnCover } from "@/lib/openlibrary";
import { sanitizeDescription } from "./sanitize";

export interface OLMetadataResult {
  description?: string;
  coverUrl?: string;
  publicationYear?: number;
  publicationDate?: string;
  pages?: number;
  isbn13?: string;
  isbn10?: string;
  publisher?: string;
  genres?: string[];
  editionsCount?: number;
}

/**
 * Fetch all available metadata from Open Library for a book.
 * This is the first call in the enrichment pipeline — everything from OL is free.
 */
export async function fetchOLMetadata(
  olKey: string,
  existingIsbn13?: string | null,
  existingIsbn10?: string | null,
): Promise<OLMetadataResult> {
  const result: OLMetadataResult = {};

  try {
    // 1. Fetch work data (description, subjects, first_publish_date)
    const work = await fetchOpenLibraryWork(olKey);
    if (!work) return result;

    // Extract description (fetchOpenLibraryWork returns description as string | null)
    // sanitizeDescription returns null if the text is unsalvageable junk
    if (work.description) {
      const cleaned = sanitizeDescription(work.description);
      if (cleaned) result.description = cleaned;
    }

    // Extract genres from subjects
    if (work.subjects && Array.isArray(work.subjects)) {
      const mapped = normalizeGenres(work.subjects);
      if (mapped.length > 0) {
        result.genres = mapped;
      }
    }

    // Fetch work-level first_publish_date (original publication year)
    // This is the ORIGINAL pub date, NOT a reprint date
    let workLevelYear: number | undefined;
    try {
      const workResp = await fetch(`https://openlibrary.org${olKey}.json`, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'tbra/1.0 (book-enrichment)' },
      });
      if (workResp.ok) {
        const workData = await workResp.json();
        if (workData.first_publish_date) {
          const yearMatch = String(workData.first_publish_date).match(/\b(\d{4})\b/);
          if (yearMatch) {
            workLevelYear = parseInt(yearMatch[1]);
          }
        }
      }
    } catch {
      // Non-critical — we'll fall back to edition dates
    }

    // 2. Fetch editions for ISBN, pages, year, publisher, cover
    const editionsUrl = `https://openlibrary.org${olKey}/editions.json?limit=20`;
    const editionsResp = await fetch(editionsUrl, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'tbra/1.0 (book-enrichment)' },
    });

    if (editionsResp.ok) {
      const editionsData = await editionsResp.json() as {
        size?: number;
        entries?: Array<{
          languages?: Array<{ key: string }>;
          number_of_pages?: number;
          publish_date?: string;
          isbn_13?: string[];
          isbn_10?: string[];
          publishers?: string[];
          covers?: number[];
          physical_format?: string;
        }>;
      };

      result.editionsCount = editionsData.size ?? editionsData.entries?.length ?? 0;

      // Prefer English editions
      const editions = editionsData.entries ?? [];
      const englishEditions = editions.filter(e =>
        !e.languages || e.languages.length === 0 ||
        e.languages.some(l => l.key === '/languages/eng')
      );
      const pool = englishEditions.length > 0 ? englishEditions : editions;

      // Score editions to find the best one
      let bestEdition = pool[0];
      let bestScore = 0;
      for (const ed of pool) {
        let s = 0;
        if (ed.number_of_pages) s += 3;
        if (ed.publish_date) s += 2;
        if (ed.isbn_13?.length) s += 2;
        if (ed.covers?.length) s += 2;
        if (ed.publishers?.length) s += 1;
        if (s > bestScore) { bestScore = s; bestEdition = ed; }
      }

      if (bestEdition) {
        if (bestEdition.number_of_pages && bestEdition.number_of_pages > 10) {
          result.pages = bestEdition.number_of_pages;
        }

        if (bestEdition.publish_date) {
          result.publicationDate = normalizeOLDate(bestEdition.publish_date);
          // Only use edition year if we don't have a work-level year (which is the original pub date)
          if (!workLevelYear) {
            const yearMatch = bestEdition.publish_date.match(/\b(\d{4})\b/);
            if (yearMatch) {
              const edYear = parseInt(yearMatch[1]);
              // Apply 1900 floor for edition-level dates
              if (edYear >= 1900) {
                result.publicationYear = edYear;
              }
            }
          }
        }

        if (bestEdition.isbn_13?.length && !existingIsbn13) {
          result.isbn13 = bestEdition.isbn_13[0];
        }
        if (bestEdition.isbn_10?.length && !existingIsbn10) {
          result.isbn10 = bestEdition.isbn_10[0];
        }

        if (bestEdition.publishers?.length) {
          result.publisher = bestEdition.publishers[0];
        }
      }

      // Prefer work-level first_publish_year (original pub date) over edition dates
      if (workLevelYear && workLevelYear > 1000 && workLevelYear < 2100) {
        result.publicationYear = workLevelYear;
      } else {
        // Fallback: find earliest year across editions, with 1900 floor
        for (const ed of editions) {
          if (ed.publish_date) {
            const m = ed.publish_date.match(/\b(\d{4})\b/);
            if (m) {
              const y = parseInt(m[1]);
              if (y >= 1900 && y < 2100 && (!result.publicationYear || y < result.publicationYear)) {
                result.publicationYear = y;
              }
            }
          }
        }
      }
    }

    // 3. Resolve cover
    const englishCover = await findEnglishCover(olKey);
    if (englishCover.coverId) {
      result.coverUrl = buildCoverUrl(englishCover.coverId, "L") ?? undefined;
    } else if (existingIsbn13 || result.isbn13) {
      const isbnCover = await findIsbnCover((existingIsbn13 || result.isbn13)!);
      if (isbnCover) result.coverUrl = isbnCover;
    } else if (existingIsbn10 || result.isbn10) {
      const isbnCover = await findIsbnCover((existingIsbn10 || result.isbn10)!);
      if (isbnCover) result.coverUrl = isbnCover;
    }

  } catch (err) {
    console.error(`[ol-metadata] Error fetching OL metadata for ${olKey}:`, err);
  }

  return result;
}

/** Normalize OL date strings to ISO-ish format */
function normalizeOLDate(dateStr: string): string {
  // "January 15, 2020" → "2020-01-15"
  const fullDate = dateStr.match(/^(\w+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (fullDate) {
    const month = monthToNum(fullDate[1]);
    if (month) return `${fullDate[3]}-${month}-${fullDate[2].padStart(2, '0')}`;
  }

  // "Mar 2020" or "March 2020" → "2020-03"
  const monthYear = dateStr.match(/^(\w+)\s+(\d{4})$/);
  if (monthYear) {
    const month = monthToNum(monthYear[1]);
    if (month) return `${monthYear[2]}-${month}`;
  }

  // "2020" → "2020"
  const yearOnly = dateStr.match(/^(\d{4})$/);
  if (yearOnly) return yearOnly[1];

  // "15 January 2020" (UK format) → "2020-01-15"
  const ukDate = dateStr.match(/^(\d{1,2})\s+(\w+)\s+(\d{4})$/);
  if (ukDate) {
    const month = monthToNum(ukDate[2]);
    if (month) return `${ukDate[3]}-${month}-${ukDate[1].padStart(2, '0')}`;
  }

  return dateStr; // return as-is if can't parse
}

const MONTHS: Record<string, string> = {
  january: '01', jan: '01', february: '02', feb: '02',
  march: '03', mar: '03', april: '04', apr: '04',
  may: '05', june: '06', jun: '06', july: '07', jul: '07',
  august: '08', aug: '08', september: '09', sep: '09', sept: '09',
  october: '10', oct: '10', november: '11', nov: '11',
  december: '12', dec: '12',
};

function monthToNum(month: string): string | null {
  return MONTHS[month.toLowerCase()] ?? null;
}
