/**
 * Parse a Goodreads CSV export into typed rows.
 *
 * Goodreads CSV columns (24):
 * Book Id, Title, Author, Author l-f, Additional Authors, ISBN, ISBN13,
 * My Rating, Average Rating, Publisher, Binding, Number of Pages,
 * Year Published, Original Publication Year, Date Read, Date Added,
 * Bookshelves, Bookshelves with positions, Exclusive Shelf, My Review,
 * Spoiler, Private Notes, Read Count, Owned Copies
 *
 * Key quirks:
 * - ISBNs wrapped in ="..." format (e.g., ="0785188894")
 * - Series info embedded in titles: "Title (Series Name, #N)"
 * - Dates in YYYY/MM/DD format
 * - Reviews contain HTML (<br/> tags)
 * - Rating 0 = not rated
 * - Spoiler column: "true" means review contains spoilers
 */

export interface GoodreadsRow {
  goodreadsId: string;
  title: string; // Cleaned title (series info removed)
  seriesName: string | null;
  seriesPosition: number | null;
  author: string;
  additionalAuthors: string[];
  isbn10: string | null;
  isbn13: string | null;
  rating: number | null; // 1-5 (null if 0/unrated)
  publisher: string | null;
  format: "hardcover" | "paperback" | "ebook" | "audiobook" | "comic" | null;
  pages: number | null;
  yearPublished: number | null;
  originalPublicationYear: number | null;
  dateRead: string | null; // ISO "YYYY-MM-DD"
  dateAdded: string | null; // ISO "YYYY-MM-DD"
  customShelves: string[]; // Non-exclusive shelves (favorite-fiction, etc.)
  readStatus: "completed" | "currently_reading" | "tbr" | null;
  review: string | null; // HTML review text
  isSpoiler: boolean;
  readCount: number;
  ownedCopies: number;
}

const HEADER_MAP: Record<string, string> = {
  "book id": "goodreadsId",
  title: "title",
  author: "author",
  "author l-f": "authorLF",
  "additional authors": "additionalAuthors",
  isbn: "isbn",
  isbn13: "isbn13",
  "my rating": "myRating",
  "average rating": "avgRating",
  publisher: "publisher",
  binding: "binding",
  "number of pages": "pages",
  "year published": "yearPublished",
  "original publication year": "originalYear",
  "date read": "dateRead",
  "date added": "dateAdded",
  bookshelves: "bookshelves",
  "bookshelves with positions": "bookshelvesPositions",
  "exclusive shelf": "exclusiveShelf",
  "my review": "review",
  spoiler: "spoiler",
  "private notes": "privateNotes",
  "read count": "readCount",
  "owned copies": "ownedCopies",
};

const STATUS_MAP: Record<string, GoodreadsRow["readStatus"]> = {
  read: "completed",
  "currently-reading": "currently_reading",
  "to-read": "tbr",
};

const FORMAT_MAP: Record<string, GoodreadsRow["format"]> = {
  paperback: "paperback",
  "mass market paperback": "paperback",
  hardcover: "hardcover",
  "leather bound": "hardcover",
  "kindle edition": "ebook",
  ebook: "ebook",
  "audio cd": "audiobook",
  audiobook: "audiobook",
  comic: "comic",
  "print on demand": "paperback",
  "board book": "hardcover",
};

/**
 * Parse CSV text handling quoted fields with commas and newlines.
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let current = "";
  let inQuotes = false;
  let row: string[] = [];

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        current += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        row.push(current.trim());
        current = "";
      } else if (ch === "\n" || (ch === "\r" && next === "\n")) {
        row.push(current.trim());
        current = "";
        if (row.length > 1 || row[0] !== "") {
          rows.push(row);
        }
        row = [];
        if (ch === "\r") i++;
      } else {
        current += ch;
      }
    }
  }

  row.push(current.trim());
  if (row.length > 1 || row[0] !== "") {
    rows.push(row);
  }

  return rows;
}

/**
 * Build column map from header row.
 */
function buildColumnMap(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < headerRow.length; i++) {
    const normalized = headerRow[i].toLowerCase().trim();
    const fieldKey = HEADER_MAP[normalized];
    if (fieldKey && !map.has(fieldKey)) {
      map.set(fieldKey, i);
    }
  }
  return map;
}

function getCell(cells: string[], columnMap: Map<string, number>, key: string): string {
  const idx = columnMap.get(key);
  if (idx === undefined) return "";
  return cells[idx]?.trim() ?? "";
}

/**
 * Strip Goodreads ISBN wrapper format: ="0785188894" → 0785188894
 */
function stripISBN(raw: string): string | null {
  if (!raw) return null;
  // Remove ="" wrapper
  let cleaned = raw.replace(/^="?/, "").replace(/"?$/, "");
  // Remove any remaining quotes
  cleaned = cleaned.replace(/"/g, "").trim();
  if (!cleaned || cleaned === "") return null;
  return cleaned;
}

/**
 * Parse series info from Goodreads title format:
 * "The Lion, the Witch and the Wardrobe (Chronicles of Narnia, #1)"
 * Returns { cleanTitle, seriesName, seriesPosition }
 */
function parseSeriesFromTitle(rawTitle: string): {
  cleanTitle: string;
  seriesName: string | null;
  seriesPosition: number | null;
} {
  // Match pattern: "Title (Series Name, #N)" or "Title (Series Name, #N.5)"
  // Also handles multiple series: "Title (Series1, #N; Series2, #N)"
  // We take the last parenthesized group that looks like a series
  const seriesMatch = rawTitle.match(/\(([^)]+,\s*#[\d.]+(?:\s*;\s*[^)]+,\s*#[\d.]+)*)\)\s*$/);

  if (!seriesMatch) {
    return { cleanTitle: rawTitle.trim(), seriesName: null, seriesPosition: null };
  }

  const cleanTitle = rawTitle.slice(0, rawTitle.lastIndexOf("(")).trim();
  const seriesText = seriesMatch[1];

  // If multiple series (separated by ;), take the first one
  const firstSeries = seriesText.split(";")[0].trim();
  const parts = firstSeries.match(/^(.+),\s*#([\d.]+)$/);

  if (parts) {
    const seriesName = parts[1].trim();
    const seriesPosition = parseFloat(parts[2]);
    return {
      cleanTitle,
      seriesName,
      seriesPosition: isNaN(seriesPosition) ? null : seriesPosition,
    };
  }

  return { cleanTitle, seriesName: null, seriesPosition: null };
}

/**
 * Parse a Goodreads date string (YYYY/MM/DD format).
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // YYYY/MM/DD format
  const match = dateStr.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (match) {
    const [, y, m, d] = match;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Also try ISO format just in case
  const isoMatch = dateStr.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  return null;
}

/**
 * Parse a Goodreads CSV export string into typed rows.
 */
export function parseGoodreadsCSV(csvText: string): GoodreadsRow[] {
  const rawRows = parseCSV(csvText);
  if (rawRows.length < 2) return [];

  const columnMap = buildColumnMap(rawRows[0]);

  if (!columnMap.has("title")) {
    console.error("[goodreads-import] CSV header missing 'Title' column. Found headers:", rawRows[0]);
    return [];
  }

  console.log("[goodreads-import] CSV column mapping:", Object.fromEntries(columnMap));

  const dataRows = rawRows.slice(1);

  return dataRows
    .map((cells): GoodreadsRow | null => {
      const rawTitle = getCell(cells, columnMap, "title");
      if (!rawTitle) return null;

      const { cleanTitle, seriesName, seriesPosition } = parseSeriesFromTitle(rawTitle);

      const goodreadsId = getCell(cells, columnMap, "goodreadsId");
      const author = getCell(cells, columnMap, "author");

      // Additional authors: comma-separated
      const additionalAuthorsRaw = getCell(cells, columnMap, "additionalAuthors");
      const additionalAuthors = additionalAuthorsRaw
        ? additionalAuthorsRaw.split(",").map((a) => a.trim()).filter(Boolean)
        : [];

      // ISBNs — strip Goodreads wrapper format
      const isbn10 = stripISBN(getCell(cells, columnMap, "isbn"));
      const isbn13 = stripISBN(getCell(cells, columnMap, "isbn13"));

      // Rating (0 = not rated)
      const ratingRaw = parseInt(getCell(cells, columnMap, "myRating"), 10);
      const rating = !isNaN(ratingRaw) && ratingRaw >= 1 && ratingRaw <= 5 ? ratingRaw : null;

      // Publisher
      const publisher = getCell(cells, columnMap, "publisher") || null;

      // Binding → Format
      const bindingRaw = getCell(cells, columnMap, "binding").toLowerCase();
      const format = FORMAT_MAP[bindingRaw] ?? null;

      // Pages
      const pagesRaw = parseInt(getCell(cells, columnMap, "pages"), 10);
      const pages = !isNaN(pagesRaw) && pagesRaw > 0 ? pagesRaw : null;

      // Publication years
      const yearPublishedRaw = parseInt(getCell(cells, columnMap, "yearPublished"), 10);
      const yearPublished = !isNaN(yearPublishedRaw) ? yearPublishedRaw : null;
      const originalYearRaw = parseInt(getCell(cells, columnMap, "originalYear"), 10);
      const originalPublicationYear = !isNaN(originalYearRaw) ? originalYearRaw : null;

      // Dates
      const dateRead = parseDate(getCell(cells, columnMap, "dateRead"));
      const dateAdded = parseDate(getCell(cells, columnMap, "dateAdded"));

      // Shelves
      const exclusiveShelf = getCell(cells, columnMap, "exclusiveShelf").toLowerCase();
      const readStatus = STATUS_MAP[exclusiveShelf] ?? null;

      // Custom shelves (non-exclusive) — comma-separated
      const shelvesRaw = getCell(cells, columnMap, "bookshelves");
      const customShelves = shelvesRaw
        ? shelvesRaw.split(",").map((s) => s.trim()).filter(Boolean)
        : [];

      // Review
      const reviewRaw = getCell(cells, columnMap, "review");
      const review = reviewRaw || null;

      // Spoiler
      const spoilerRaw = getCell(cells, columnMap, "spoiler").toLowerCase();
      const isSpoiler = spoilerRaw === "true";

      // Read Count
      const readCountRaw = parseInt(getCell(cells, columnMap, "readCount"), 10);
      const readCount = !isNaN(readCountRaw) && readCountRaw > 0 ? readCountRaw : 1;

      // Owned Copies
      const ownedRaw = parseInt(getCell(cells, columnMap, "ownedCopies"), 10);
      const ownedCopies = !isNaN(ownedRaw) ? ownedRaw : 0;

      return {
        goodreadsId,
        title: cleanTitle,
        seriesName,
        seriesPosition,
        author,
        additionalAuthors,
        isbn10,
        isbn13,
        rating,
        publisher,
        format,
        pages,
        yearPublished,
        originalPublicationYear,
        dateRead,
        dateAdded,
        customShelves,
        readStatus,
        review,
        isSpoiler,
        readCount,
        ownedCopies,
      };
    })
    .filter((row): row is GoodreadsRow => row !== null);
}
