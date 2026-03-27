/**
 * Parse a Libby (OverDrive) CSV export into typed rows.
 *
 * Libby CSV columns (9):
 * cover, title, author, publisher, isbn, timestamp, activity, details, library
 *
 * Key quirks:
 * - All rows are "Borrowed" activity (Libby only exports borrow events)
 * - ISBNs are audiobook ISBNs (may not match print editions in DB)
 * - Authors can be comma-separated: "Michael Crichton, James Patterson"
 * - Timestamps: "February 20, 2026 12:39"
 * - Same book may appear multiple times (re-borrowed)
 * - Publishers often contain commas: "Tantor Media, Inc"
 * - Cover URLs from OverDrive CDN (don't use these — low quality)
 * - Some ISBNs may be empty
 */

export interface LibbyRow {
  title: string;
  authors: string[];
  isbn: string | null;
  publisher: string | null;
  borrowDate: string; // ISO date string "YYYY-MM-DD"
}

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
 * Map of normalized header names → our field keys.
 */
const HEADER_MAP: Record<string, string> = {
  cover: "cover",
  title: "title",
  author: "author",
  publisher: "publisher",
  isbn: "isbn",
  timestamp: "timestamp",
  activity: "activity",
  details: "details",
  library: "library",
};

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
 * Parse Libby timestamp format: "February 20, 2026 12:39" → "2026-02-20"
 */
function parseLibbyTimestamp(raw: string): string | null {
  if (!raw) return null;

  // Parse "Month Day, Year HH:MM" format
  const dateObj = new Date(raw);
  if (!isNaN(dateObj.getTime())) {
    const y = dateObj.getFullYear();
    const m = String(dateObj.getMonth() + 1).padStart(2, "0");
    const d = String(dateObj.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
}

/**
 * Split Libby author field into individual authors.
 * Libby uses comma separation: "Michael Crichton, James Patterson"
 * But some author names themselves might have suffixes like "Jr." or "III"
 * We split on ", " followed by an uppercase letter (start of a new name).
 */
function splitAuthors(raw: string): string[] {
  if (!raw) return [];

  // Handle editor notation: "Harry Turtledove (ed.)" → "Harry Turtledove"
  const cleaned = raw.replace(/\s*\(ed\.\)\s*/gi, "");

  // Split on comma-space where the next segment starts with an uppercase letter
  // This handles "Michael Crichton, James Patterson" but not "Turtledove, Jr."
  const authors: string[] = [];
  const parts = cleaned.split(",");

  let current = "";
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (current && /^[A-Z]/.test(trimmed)) {
      // New author starts with uppercase — save previous and start new
      authors.push(current.trim());
      current = trimmed;
    } else if (current) {
      // Continuation (e.g., "Jr." or "III")
      current += ", " + trimmed;
    } else {
      current = trimmed;
    }
  }
  if (current) authors.push(current.trim());

  return authors.filter(Boolean);
}

/**
 * Parse a Libby CSV export string into typed rows.
 * Deduplicates by ISBN (keeps most recent borrow per book).
 * For books without ISBN, deduplicates by title+author.
 */
export function parseLibbyCSV(csvText: string): LibbyRow[] {
  const rawRows = parseCSV(csvText);
  if (rawRows.length < 2) return [];

  const columnMap = buildColumnMap(rawRows[0]);

  // Require at least a "title" column
  if (!columnMap.has("title")) {
    console.error("[libby-import] CSV header missing 'title' column. Found headers:", rawRows[0]);
    return [];
  }

  console.log("[libby-import] CSV column mapping:", Object.fromEntries(columnMap));

  const dataRows = rawRows.slice(1);

  // Parse all rows
  const allRows: (LibbyRow & { _sortKey: string })[] = [];

  for (const cells of dataRows) {
    const title = getCell(cells, columnMap, "title");
    if (!title) continue;

    const authorRaw = getCell(cells, columnMap, "author");
    const authors = splitAuthors(authorRaw);

    const isbnRaw = getCell(cells, columnMap, "isbn");
    const isbn = isbnRaw && /^\d{10,13}$/.test(isbnRaw.replace(/[-\s]/g, ""))
      ? isbnRaw.replace(/[-\s]/g, "")
      : null;

    const publisher = getCell(cells, columnMap, "publisher") || null;

    const timestampRaw = getCell(cells, columnMap, "timestamp");
    const borrowDate = parseLibbyTimestamp(timestampRaw);
    if (!borrowDate) continue; // skip rows without a valid date

    allRows.push({
      title,
      authors,
      isbn,
      publisher,
      borrowDate,
      _sortKey: isbn ?? `${title.toLowerCase()}|||${(authors[0] ?? "").toLowerCase()}`,
    });
  }

  // Sort by borrow date descending (most recent first)
  allRows.sort((a, b) => b.borrowDate.localeCompare(a.borrowDate));

  // Deduplicate: keep only the most recent borrow per book
  const seen = new Set<string>();
  const deduplicated: LibbyRow[] = [];

  for (const row of allRows) {
    if (seen.has(row._sortKey)) continue;
    seen.add(row._sortKey);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _sortKey, ...libbyRow } = row;
    deduplicated.push(libbyRow);
  }

  console.log(
    `[libby-import] Parsed ${allRows.length} borrows → ${deduplicated.length} unique books`
  );

  return deduplicated;
}
