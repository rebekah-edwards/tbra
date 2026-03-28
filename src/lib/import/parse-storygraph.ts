/**
 * Parse a StoryGraph CSV export into typed rows.
 *
 * Header-aware parser — reads column names from the first row and maps them
 * dynamically, so it works regardless of column ordering changes in StoryGraph.
 */

export interface StoryGraphRow {
  title: string;
  authors: string[];
  isbn: string | null;
  asin: string | null;
  format: "hardcover" | "paperback" | "ebook" | "audiobook" | null;
  rating: number | null;
  readStatus: "completed" | "currently_reading" | "tbr" | "dnf" | "paused" | null;
  lastDateRead: string | null; // ISO date string "YYYY-MM-DD"
  owned: boolean;
  review: string | null; // HTML review text from StoryGraph
  contentWarnings: string | null; // Content warning text
  moods: string[]; // Mood tags like "adventurous", "inspiring"
}

const STATUS_MAP: Record<string, StoryGraphRow["readStatus"]> = {
  read: "completed",
  "currently-reading": "currently_reading",
  "to-read": "tbr",
  "did-not-finish": "dnf",
  paused: "paused",
};

const FORMAT_MAP: Record<string, StoryGraphRow["format"]> = {
  physical: "paperback",
  paperback: "paperback",
  hardcover: "hardcover",
  hardback: "hardcover",
  audio: "audiobook",
  audiobook: "audiobook",
  digital: "ebook",
  ebook: "ebook",
  "kindle edition": "ebook",
};

/**
 * Map of normalized header names → our field keys.
 * Supports multiple variations of the same column name.
 */
const HEADER_MAP: Record<string, string> = {
  title: "title",
  authors: "authors",
  "isbn/uid": "isbn",
  isbn: "isbn",
  format: "format",
  "star rating": "rating",
  rating: "rating",
  "read status": "readStatus",
  "last date read": "lastDateRead",
  "owned?": "owned",
  owned: "owned",
  review: "review",
  "content warnings": "contentWarnings",
  "content warning description": "contentWarningDesc",
  moods: "moods",
  tags: "tags",
};

/**
 * Parse CSV text handling quoted fields with commas and newlines.
 * Returns an array of string arrays (rows of cells).
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
        i++; // skip escaped quote
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
        if (ch === "\r") i++; // skip \n after \r
      } else {
        current += ch;
      }
    }
  }

  // Last field/row
  row.push(current.trim());
  if (row.length > 1 || row[0] !== "") {
    rows.push(row);
  }

  return rows;
}

/**
 * Build a mapping from our field keys to column indices using the header row.
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

/**
 * Get a cell value by field key, returning empty string if not found.
 */
function getCell(cells: string[], columnMap: Map<string, number>, key: string): string {
  const idx = columnMap.get(key);
  if (idx === undefined) return "";
  return cells[idx]?.trim() ?? "";
}

/**
 * Snap a rating to the nearest 0.25 increment (tbr*a supports quarter-star ratings).
 */
function snapRating(raw: number): number {
  const snapped = Math.round(raw * 4) / 4;
  return Math.max(0.25, Math.min(5, snapped));
}

/**
 * Parse a StoryGraph date string. Formats vary: "2024/01/15", "2024-01-15", "January 2024", etc.
 */
function parseDate(dateStr: string): string | null {
  if (!dateStr) return null;

  // Try ISO-ish formats: 2024-01-15, 2024/01/15
  const isoMatch = dateStr.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // Try "Month Year" or "Month Day, Year"
  const dateObj = new Date(dateStr);
  if (!isNaN(dateObj.getTime())) {
    return dateObj.toISOString().slice(0, 10);
  }

  return null;
}

/**
 * Parse a StoryGraph CSV export string into typed rows.
 * Reads the header row to determine column positions dynamically.
 */
export function parseStoryGraphCSV(csvText: string): StoryGraphRow[] {
  const rawRows = parseCSV(csvText);
  if (rawRows.length < 2) return []; // need header + at least one data row

  // Build column map from header row
  const columnMap = buildColumnMap(rawRows[0]);

  // Require at least a "title" column
  if (!columnMap.has("title")) {
    console.error("[import] CSV header missing 'Title' column. Found headers:", rawRows[0]);
    return [];
  }

  console.log("[import] CSV column mapping:", Object.fromEntries(columnMap));

  const dataRows = rawRows.slice(1);

  return dataRows
    .map((cells): StoryGraphRow | null => {
      const title = getCell(cells, columnMap, "title");
      if (!title) return null;

      // Authors: semicolon-separated
      const authorsRaw = getCell(cells, columnMap, "authors");
      const authors = authorsRaw
        .split(";")
        .map((a) => a.trim())
        .filter(Boolean);

      // ISBN/UID — detect numeric ISBNs and alphanumeric ASINs separately
      const isbnRaw = getCell(cells, columnMap, "isbn");
      const isbnClean = isbnRaw ? isbnRaw.replace(/[-\s]/g, "") : "";
      const isbn = /^\d{10,13}$/.test(isbnClean) ? isbnClean : null;
      const asin = !isbn && /^B[A-Z0-9]{9}$/.test(isbnClean) ? isbnClean : null;

      // Format
      const formatRaw = getCell(cells, columnMap, "format").toLowerCase();
      const format = FORMAT_MAP[formatRaw] ?? null;

      // Star Rating
      const ratingRaw = parseFloat(getCell(cells, columnMap, "rating"));
      const rating = !isNaN(ratingRaw) && ratingRaw > 0 ? snapRating(ratingRaw) : null;

      // Read Status
      const statusRaw = getCell(cells, columnMap, "readStatus").toLowerCase();
      const readStatus = STATUS_MAP[statusRaw] ?? null;

      // Last Date Read
      const lastDateRead = parseDate(getCell(cells, columnMap, "lastDateRead"));

      // Owned
      const ownedRaw = getCell(cells, columnMap, "owned").toLowerCase();
      const owned = ownedRaw === "yes" || ownedRaw === "true" || ownedRaw === "1";

      // Review (HTML from StoryGraph)
      const reviewRaw = getCell(cells, columnMap, "review");
      const review = reviewRaw ? reviewRaw.trim() : null;

      // Content warnings
      const cwRaw = getCell(cells, columnMap, "contentWarningDesc") || getCell(cells, columnMap, "contentWarnings");
      const contentWarnings = cwRaw ? cwRaw.trim() : null;

      // Moods (comma-separated)
      const moodsRaw = getCell(cells, columnMap, "moods");
      const moods = moodsRaw
        ? moodsRaw.split(",").map((m) => m.trim()).filter(Boolean)
        : [];

      return { title, authors, isbn, asin, format, rating, readStatus, lastDateRead, owned, review, contentWarnings, moods };
    })
    .filter((row): row is StoryGraphRow => row !== null);
}
