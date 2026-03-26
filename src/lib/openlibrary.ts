const BASE_URL = "https://openlibrary.org";
const COVERS_URL = "https://covers.openlibrary.org";
const USER_AGENT = "tbra/0.1.0 (https://github.com/rebekah-edwards/tbra)";

export interface OLSearchResult {
  key: string; // e.g. "/works/OL12345W"
  title: string;
  author_name?: string[];
  author_key?: string[]; // e.g. ["/authors/OL12345A"]
  first_publish_year?: number;
  cover_i?: number;
  isbn?: string[];
  number_of_pages_median?: number;
  /** English edition title when the work's canonical title is in another language */
  englishTitle?: string;
}

interface OLSearchResponse {
  numFound: number;
  docs: OLSearchResult[];
}

interface OLWorkResponse {
  description?: string | { value: string };
  covers?: number[];
  title: string;
  subjects?: string[];
}

async function olFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 3600 },
  });
}

/** Check if a string looks like an ISBN (10 or 13 digits, with optional hyphens/spaces) */
function extractIsbn(query: string): string | null {
  const cleaned = query.replace(/[\s-]/g, "");
  if (/^\d{13}$/.test(cleaned) || /^\d{9}[\dXx]$/.test(cleaned)) {
    return cleaned;
  }
  return null;
}

/** Look up a book directly by ISBN via Open Library's ISBN endpoint */
async function lookupByIsbn(isbn: string): Promise<OLSearchResult | null> {
  try {
    const res = await olFetch(`${BASE_URL}/isbn/${isbn}.json`);
    if (!res.ok) return null;
    const edition = await res.json();

    // Get the work key from this edition
    const workKey = edition.works?.[0]?.key;
    if (!workKey) return null;

    // Fetch the work for canonical title and author info
    const workRes = await olFetch(`${BASE_URL}${workKey}.json`);
    if (!workRes.ok) return null;
    const work = await workRes.json();

    // Get author names
    const authorKeys: string[] = (work.authors ?? []).map(
      (a: { author?: { key: string }; key?: string }) => a.author?.key ?? a.key
    ).filter(Boolean);
    const authorNames: string[] = [];
    for (const key of authorKeys.slice(0, 3)) {
      try {
        const aRes = await olFetch(`${BASE_URL}${key}.json`);
        if (aRes.ok) {
          const author = await aRes.json();
          if (author.name) authorNames.push(author.name);
        }
      } catch { /* skip */ }
    }

    // Prefer edition title (often the English translated title) over canonical work title
    const editionTitle = edition.title ?? work.title;
    const workTitle = work.title ?? edition.title;
    // If the edition title differs from the work title, show edition as main + work as original
    const titlesDiffer = editionTitle.toLowerCase() !== workTitle.toLowerCase();

    return {
      key: workKey,
      title: titlesDiffer ? editionTitle : workTitle,
      englishTitle: undefined, // edition title IS the English title
      author_name: authorNames.length > 0 ? authorNames : undefined,
      first_publish_year: (() => {
        // Prefer the work's original first_publish_date over the edition date
        const workYear = work.first_publish_date
          ? parseInt(String(work.first_publish_date).match(/\d{4}/)?.[0] ?? "", 10)
          : undefined;
        const editionYear = edition.publish_date
          ? parseInt(edition.publish_date.match(/\d{4}/)?.[0] ?? "", 10)
          : undefined;
        // Use the earlier year (original publication), falling back to edition
        if (workYear && editionYear) return Math.min(workYear, editionYear);
        return workYear || editionYear || undefined;
      })(),
      cover_i: edition.covers?.[0] ?? work.covers?.[0] ?? undefined,
      isbn: [isbn],
      number_of_pages_median: edition.number_of_pages ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Find the English edition title of a work by scanning its editions.
 * Returns the title of the first English-language edition, or null.
 */
export async function findEnglishEditionTitle(workKey: string): Promise<string | null> {
  try {
    const { entries } = await fetchWorkEditions(workKey, 50, 0);
    for (const edition of entries) {
      const langs = edition.languages?.map((l) => l.key) ?? [];
      const isEnglish = langs.some((k) => k === "/languages/eng");
      if (isEnglish && edition.title) {
        return edition.title;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// Patterns that indicate junk/derivative works (summaries, study guides, etc.)
const JUNK_TITLE_PATTERNS = [
  /^untitled$/i,
  /\bsummary\b/i,
  /\breview\s*(:|and|&)/i,
  /\bstudy\s*guide\b/i,
  /\bcliffs?\s*notes\b/i,
  /\bspark\s*notes\b/i,
  /\bbook\s*analysis\b/i,
  /\bdetailed\s*summary\b/i,
  /\bquick\s*read\b/i,
  /\breading\s*guide\b/i,
  /\bcompanion\s*guide\b/i,
  /\blitchart\b/i,
  /\bsuperSummary\b/i,
  /\b(a|the)\s+novel\s+approach\b/i,
  /\bworkbook\b/i,
  /\bteacher'?s?\s*guide\b/i,
  /\blesson\s*plans?\b/i,
  /^biography\s+of\b/i,
  /\[paperback\]/i,
  // Box sets / collections / omnibus editions
  /\bbox\s*set\b/i,
  /\bboxed\s*set\b/i,
  /\bcollection\s+(set|of)\b/i,
  /\bseries\s+collection\b/i,
  /\bcomplete\s+collection\b/i,
  /\bsaga\s+collection\b/i,
  /\b(books?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(volumes?\s+\d+\s*[-–—]\s*\d+)\b/i,
  /\b(omnibus|compendium|complete\s+series)\b/i,
  /\b\d+\s*-?\s*book\s+(set|bundle|pack|series|collection)\b/i,
  /\bhardcover\s+series\b/i,
  // Non-book editions (CDs, coloring books, merchandise, etc.)
  /\bcoloring\s*book\b/i,
  /\bcolouring\s*book\b/i,
  /\bactivity\s*book\b/i,
  /\bgiant\s*poster\b/i,
  /\blow\s*price\s*cd\b/i,
  /\b(audio\s*)?cd\s*$/i,       // title ending in "CD"
  /\b\d+\s*-?\s*pack\b/i,       // "6 Pack", "6-Pack"
  /\bpop-?up\s*book\b/i,
  /\bboard\s*book\b/i,
  /\bsticker\s*book\b/i,
  /\bflip\s*book\b/i,
  /\bpuzzle\s*book\b/i,
  /\bselections?\s+from\b/i,    // "Selections from..."
  /\bbind[\s-]*up\b/i,           // "Tpb Bind up", "Bind-up"
  /^novels?\s*\(/i,             // "Novels (X / Y)" omnibus
  /\bvolume\s+\d+\s*$/i,       // Standalone "Volume X" (comics)
  /\billustrated\s+edition\b/i,
  /\bnº\s*\d+/i,               // Spanish/foreign comic issue numbers
  /\btomo\s+/i,                 // Spanish "Tomo" (volume)
  /\bBooks?\s+Collection\s+Set\b/i,
  /\bBoxed\s+Set\b/i,
];

/** Check if a title looks like a summary/study-guide derivative or a box set */
export function isJunkTitle(title: string): boolean {
  return JUNK_TITLE_PATTERNS.some((p) => p.test(title));
}

export async function searchOpenLibrary(
  query: string,
  limit = 20
): Promise<OLSearchResult[]> {
  const trimmed = query.trim();
  const queryLower = trimmed.toLowerCase();
  // Stop words to ignore when checking relevance
  const STOP_WORDS = new Set(["the", "a", "an", "is", "in", "of", "and", "to", "for", "on", "at", "by", "with", "from"]);
  const queryWords = queryLower.split(/\s+/).filter((w) => w.length > 1 && !STOP_WORDS.has(w));

  /** Check if a result is relevant to the query */
  function isRelevant(r: OLSearchResult): boolean {
    // Filter out summaries, study guides, box sets, etc.
    if (isJunkTitle(r.title)) return false;

    const titleLower = r.title.toLowerCase();
    const engLower = r.englishTitle?.toLowerCase() ?? "";
    const authorLower = (r.author_name ?? []).join(" ").toLowerCase();
    const combined = `${titleLower} ${engLower}`;

    // Full query appears in title or english title (substring match)
    if (titleLower.includes(queryLower) || queryLower.includes(titleLower)) return true;
    if (engLower && (engLower.includes(queryLower) || queryLower.includes(engLower))) return true;

    // Word-level matching: ALL content words must appear in title+author,
    // and the title shouldn't be vastly longer than the query (avoids matching
    // obscure works where common words appear scattered in a very long title).
    if (queryWords.length > 0) {
      const allInTitleOrAuthor = queryWords.every(
        (w) => titleLower.includes(w) || engLower.includes(w) || authorLower.includes(w)
      );
      if (allInTitleOrAuthor) {
        // If query has distinctive words (5+ chars), trust the word match
        const hasDistinctive = queryWords.some((w) => w.length >= 5);
        if (hasDistinctive) return true;

        // All short/common words — only match if the title is reasonably concise
        // (long titles like 17th-century treatises match too many short words by accident)
        const titleWordCount = titleLower.split(/\s+/).length;
        if (titleWordCount <= 12) return true;
      }
    }

    return false;
  }

  // 1. Check if query is an ISBN — do direct lookup
  const isbn = extractIsbn(trimmed);
  if (isbn) {
    const result = await lookupByIsbn(isbn);
    if (result) return [result];
    // ISBN lookup failed, fall through to regular search
  }

  // 2. Regular title/author search
  const fields = "key,title,author_name,author_key,first_publish_year,cover_i,isbn,number_of_pages_median";
  const params = new URLSearchParams({
    q: trimmed,
    limit: String(limit),
    fields,
    sort: "editions",
  });
  const res = await olFetch(`${BASE_URL}/search.json?${params}`);
  if (!res.ok) return [];
  const data: OLSearchResponse = await res.json();

  // Filter main results for relevance — OL full-text matches too broadly
  let results = data.docs.filter(isRelevant);

  // 3. If few/no relevant results, try additional search strategies
  if (results.length < 3 && !isbn) {
    const existingKeys = new Set(results.map((r) => r.key));

    // 3a. Try quoted phrase search — catches translated editions indexed with English text
    if (queryWords.length >= 2) {
      const phraseParams = new URLSearchParams({
        q: `"${trimmed}"`,
        limit: "10",
        fields,
      });
      const phraseRes = await olFetch(`${BASE_URL}/search.json?${phraseParams}`);
      if (phraseRes.ok) {
        const phraseData: OLSearchResponse = await phraseRes.json();
        for (const r of phraseData.docs) {
          if (existingKeys.has(r.key)) continue;
          // Resolve English title if the canonical title doesn't match
          const titleLower = r.title.toLowerCase();
          if (!titleLower.includes(queryLower) && !queryLower.includes(titleLower)) {
            const engTitle = await findEnglishEditionTitle(r.key);
            if (engTitle) r.englishTitle = engTitle;
          }
          // Apply same relevance filter as the main search
          if (!isRelevant(r)) continue;
          results.push(r);
          existingKeys.add(r.key);
        }
      }
    }

    // 3b. Try title= search for works with matching original title
    if (results.length < 3) {
      const altParams = new URLSearchParams({
        title: trimmed,
        limit: "10",
        fields,
      });
      const altRes = await olFetch(`${BASE_URL}/search.json?${altParams}`);
      if (altRes.ok) {
        const altData: OLSearchResponse = await altRes.json();
        let altResults = altData.docs.filter((r) => !existingKeys.has(r.key));

        // Resolve English edition titles since canonical titles may be in another language
        if (altResults.length > 0) {
          const englishTitles = await Promise.all(
            altResults.slice(0, 8).map((r) => findEnglishEditionTitle(r.key))
          );

          for (let i = 0; i < Math.min(altResults.length, 8); i++) {
            if (englishTitles[i]) {
              altResults[i].englishTitle = englishTitles[i]!;
            }
          }

          altResults = altResults.filter(isRelevant);
        }

        for (const r of altResults) {
          results.push(r);
          existingKeys.add(r.key);
        }
      }
    }
  }

  // Deduplicate by work key (OL sometimes returns the same work from multiple search strategies)
  const seenKeys = new Set<string>();
  results = results.filter((r) => {
    if (seenKeys.has(r.key)) return false;
    seenKeys.add(r.key);
    return true;
  });

  // Fuzzy title dedup: OL often has multiple "works" for the same book
  // (e.g. different editions imported as separate works). Collapse them by
  // normalized title + first author, keeping the highest-quality entry.
  const seenNormalized = new Map<string, number>(); // normalized key → index in results
  results = results.filter((r, idx) => {
    const normTitle = r.title.toLowerCase()
      .replace(/\s*[:\-–—([\/{]\s*.*$/, "") // strip subtitles
      .replace(/^(the|a|an)\s+/i, "") // strip articles
      .replace(/[^a-z0-9]/g, ""); // alphanumeric only
    const firstAuthor = (r.author_name?.[0] ?? "").toLowerCase().replace(/[^a-z]/g, "");
    const dedupKey = `${normTitle}:${firstAuthor}`;

    if (seenNormalized.has(dedupKey)) {
      // Keep the one with better data (cover + pages)
      const prevIdx = seenNormalized.get(dedupKey)!;
      const prevQuality = (results[prevIdx].cover_i ? 2 : 0) + (results[prevIdx].number_of_pages_median ? 1 : 0);
      const thisQuality = (r.cover_i ? 2 : 0) + (r.number_of_pages_median ? 1 : 0);
      if (thisQuality > prevQuality) {
        // Replace the previous entry
        results[prevIdx] = { ...results[prevIdx], _skip: true } as OLSearchResult & { _skip?: boolean };
        seenNormalized.set(dedupKey, idx);
        return true;
      }
      return false;
    }
    seenNormalized.set(dedupKey, idx);
    return true;
  });
  // Remove any entries that were replaced
  results = results.filter((r) => !(r as OLSearchResult & { _skip?: boolean })._skip);

  // Re-rank: boost exact title matches + results with covers/pages
  results.sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    const aEng = a.englishTitle?.toLowerCase() ?? "";
    const bEng = b.englishTitle?.toLowerCase() ?? "";

    // Title match score: exact = 0, contains = 1, partial = 2
    const aMatch = aTitle === queryLower || aEng === queryLower ? 0
      : aTitle.includes(queryLower) || aEng.includes(queryLower) ? 1 : 2;
    const bMatch = bTitle === queryLower || bEng === queryLower ? 0
      : bTitle.includes(queryLower) || bEng.includes(queryLower) ? 1 : 2;
    if (aMatch !== bMatch) return aMatch - bMatch;

    // Quality score: prefer results with covers and page counts
    const aQuality = (a.cover_i ? 2 : 0) + (a.number_of_pages_median ? 1 : 0);
    const bQuality = (b.cover_i ? 2 : 0) + (b.number_of_pages_median ? 1 : 0);
    return bQuality - aQuality;
  });

  return results;
}

export async function fetchOpenLibraryWork(
  workKey: string
): Promise<{ title: string | null; description: string | null; coverId: number | null; subjects: string[] }> {
  const res = await olFetch(`${BASE_URL}${workKey}.json`);
  if (!res.ok) return { title: null, description: null, coverId: null, subjects: [] };
  const data: OLWorkResponse = await res.json();
  return {
    title: data.title ?? null,
    description: extractDescription(data.description),
    coverId: data.covers?.[0] ?? null,
    subjects: data.subjects ?? [],
  };
}

// Normalize Open Library subjects into clean genre tags
const GENRE_MAP: Record<string, string> = {
  "literary fiction": "Literary Fiction",
  "science fiction": "Sci-Fi",
  "fantasy": "Fantasy",
  "romance": "Romance",
  "mystery": "Mystery",
  "thriller": "Thriller",
  "thrillers": "Thriller",
  "horror": "Horror",
  "historical fiction": "Historical Fiction",
  "young adult": "Young Adult",
  "young adult fiction": "Young Adult",
  "children's fiction": "Children's",
  "children": "Children's",
  "biography": "Biography",
  "memoir": "Memoir",
  "autobiography": "Memoir",
  "self-help": "Self-Help",
  "philosophy": "Philosophy",
  "poetry": "Poetry",
  "drama": "Drama",
  "humor": "Humor",
  "dystopia": "Dystopia",
  "dystopian fiction": "Dystopia",
  "adventure": "Adventure",
  "classics": "Classics",
  "classic literature": "Classics",
  "gothic fiction": "Gothic",
  "gothic": "Gothic",
  "magical realism": "Magical Realism",
  "paranormal": "Paranormal",
  "crime": "Crime",
  "crime fiction": "Crime",
  "war": "War",
  "war fiction": "War",
  "psychological fiction": "Psychological Fiction",
  "graphic novels": "Graphic Novel",
  "comics": "Graphic Novel",
  "nonfiction": "Nonfiction",
  "non-fiction": "Nonfiction",
  "true crime": "True Crime",
  "mythology": "Mythology",
  "fairy tales": "Fairy Tales",
  "afrofuturism": "Afrofuturism",
  "contemporary": "Contemporary",
  "contemporary fiction": "Contemporary",
  "suspense": "Suspense",
  "dark fantasy": "Dark Fantasy",
  "epic fantasy": "Epic Fantasy",
  "urban fantasy": "Urban Fantasy",
  "space opera": "Space Opera",
  "survival": "Survival",
  "political fiction": "Political Fiction",
  "satire": "Satire",
  "speculative fiction": "Speculative Fiction",
  "literary": "Literary Fiction",
  "domestic fiction": "Domestic Fiction",
  "love stories": "Romance",
  "christian fiction": "Christian Fiction",
  "religious fiction": "Christian Fiction",
  "inspirational fiction": "Christian Fiction",
  "christian life": "Christian Fiction",
  "amish": "Amish Fiction",
  "amish fiction": "Amish Fiction",
};

// Subjects to skip (noise from OL)
const NOISE_SUBJECTS = new Set([
  "accessible book",
  "protected daisy",
  "in library",
  "lending library",
  "new york times bestseller",
  "nyt:bestseller",
  "open library staff picks",
  "popular print disabled books",
  "long now manual for civilization",
  "large type books",
  "reading level",
  "fiction, general",
  "general",
  "literature",
  "american literature",
  "english literature",
  "british literature",
  "american fiction",
  "english fiction",
  "fiction",
]);

export function normalizeGenres(subjects: string[]): string[] {
  const genres = new Set<string>();
  for (const subject of subjects) {
    const lower = subject.toLowerCase().trim();
    if (NOISE_SUBJECTS.has(lower)) continue;
    const mapped = GENRE_MAP[lower];
    if (mapped) genres.add(mapped);
  }
  return Array.from(genres).slice(0, 6); // Cap at 6 genres
}

export function extractDescription(
  desc: string | { value: string } | undefined
): string | null {
  if (!desc) return null;
  if (typeof desc === "string") return desc;
  return desc.value ?? null;
}

export function buildCoverUrl(
  coverId: number | null | undefined,
  size: "S" | "M" | "L" = "M"
): string | null {
  if (!coverId) return null;
  return `${COVERS_URL}/b/id/${coverId}-${size}.jpg`;
}

/**
 * Check if Open Library has a cover image for a given ISBN.
 * Uses the OL ISBN cover endpoint directly — free, no API key needed.
 * OL returns a tiny ~807-byte transparent 1x1 placeholder for missing covers,
 * so we validate via Content-Length > 1000.
 */
export async function findIsbnCover(isbn: string): Promise<string | null> {
  const url = `${COVERS_URL}/b/isbn/${isbn}-L.jpg`;
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const contentLength = parseInt(res.headers.get("content-length") ?? "0", 10);
    if (contentLength > 1000) {
      return url;
    }
    return null;
  } catch {
    return null;
  }
}

// ─── Edition Format Classification ───

const FORMAT_KEYWORDS: Record<string, string[]> = {
  hardcover: ["hardcover", "hardback", "hard cover", "grand format", "gebunden"],
  paperback: ["paperback", "softcover", "perfect paperback", "mass market paperback", "trade paperback"],
  ebook: ["ebook", "e-book", "kindle", "electronic"],
  audiobook: ["audiobook", "audio", "audible", "cd", "mp3"],
};

/** Map an Open Library `physical_format` string to one of our four format keys, or null if unknown. */
export function classifyEditionFormat(physicalFormat?: string): string | null {
  if (!physicalFormat) return null;
  const lower = physicalFormat.toLowerCase().trim();
  for (const [format, keywords] of Object.entries(FORMAT_KEYWORDS)) {
    if (keywords.some((kw) => lower.includes(kw))) return format;
  }
  return null;
}

// ─── Editions ───

export interface OLEdition {
  key: string; // e.g. "/books/OL7353617M"
  title: string;
  publish_date?: string;
  publishers?: string[];
  isbn_13?: string[];
  isbn_10?: string[];
  covers?: number[];
  number_of_pages?: number;
  physical_format?: string;
  languages?: { key: string }[];
}

interface OLEditionsResponse {
  entries: OLEdition[];
  size: number;
}

export async function fetchWorkEditions(
  workKey: string,
  limit = 50,
  offset = 0
): Promise<{ entries: OLEdition[]; size: number }> {
  const res = await olFetch(
    `${BASE_URL}${workKey}/editions.json?limit=${limit}&offset=${offset}`
  );
  if (!res.ok) return { entries: [], size: 0 };
  const data: OLEditionsResponse = await res.json();
  return {
    entries: data.entries ?? [],
    size: data.size ?? 0,
  };
}

export interface OLAuthorWork {
  key: string; // e.g. "/works/OL12345W"
  title: string;
  covers?: number[];
}

interface OLAuthorWorksResponse {
  entries: OLAuthorWork[];
}

/**
 * Fetch the description for an OL work. Returns the text or null.
 * OL descriptions can be a plain string or { type, value } object.
 */
export async function fetchWorkDescription(workKey: string): Promise<string | null> {
  try {
    const res = await olFetch(`${BASE_URL}${workKey}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    const desc = data.description;
    if (typeof desc === "string") return desc;
    if (desc?.value && typeof desc.value === "string") return desc.value;
    return null;
  } catch {
    return null;
  }
}

/**
 * Lightweight: fetch only the earliest publication year across all editions of a work.
 * Does NOT resolve covers — much cheaper than findOldestHardcoverCover.
 * Scans up to 200 editions, returns the minimum year found or null.
 */
export async function fetchEarliestPublishYear(workKey: string): Promise<number | null> {
  let earliestYear: number | null = null;
  let offset = 0;
  const PAGE_SIZE = 50;
  const MAX_EDITIONS = 200;

  while (offset < MAX_EDITIONS) {
    const { entries, size } = await fetchWorkEditions(workKey, PAGE_SIZE, offset);
    if (entries.length === 0) break;

    for (const edition of entries) {
      const yearMatch = edition.publish_date?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      if (year != null && (earliestYear == null || year < earliestYear)) {
        earliestYear = year;
      }
    }

    offset += PAGE_SIZE;
    if (offset >= size) break;
  }

  return earliestYear;
}

/**
 * Find the cover ID of the oldest hardcover edition for a work,
 * and the earliest publication year across ALL editions.
 * Paginates through editions (up to 200).
 */
export async function findOldestHardcoverCover(workKey: string): Promise<{ coverId: number | null; year: number | null }> {
  const hardcovers: { coverId: number; year: number }[] = [];
  let earliestYear: number | null = null;
  let offset = 0;
  const PAGE_SIZE = 50;
  const MAX_EDITIONS = 200;

  while (offset < MAX_EDITIONS) {
    const { entries, size } = await fetchWorkEditions(workKey, PAGE_SIZE, offset);
    if (entries.length === 0) break;

    for (const edition of entries) {
      // Extract year from free-text publish_date (e.g., "1960", "January 1, 1960", "1960-01-01")
      const yearMatch = edition.publish_date?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;

      // Track earliest year across ALL editions
      if (year != null && (earliestYear == null || year < earliestYear)) {
        earliestYear = year;
      }

      // Only collect hardcovers with covers for the cover search
      const format = classifyEditionFormat(edition.physical_format);
      if (format !== "hardcover") continue;
      const coverId = edition.covers?.[0];
      if (!coverId || coverId <= 0) continue;

      hardcovers.push({ coverId, year: year ?? 9999 });
    }

    offset += PAGE_SIZE;
    if (offset >= size) break;
  }

  // Sort hardcovers by year ascending (oldest first)
  hardcovers.sort((a, b) => a.year - b.year);
  const coverId = hardcovers.length > 0 ? hardcovers[0].coverId : null;

  return { coverId, year: earliestYear };
}

/**
 * Find the best English-language cover for a work.
 * Paginates editions, filters to those with languages including /languages/eng,
 * prefers hardcovers, falls back to any English edition with a cover.
 * Editions with no language data are treated as lower priority (not excluded).
 */
export async function findEnglishCover(workKey: string): Promise<{ coverId: number | null }> {
  const englishCovers: { coverId: number; isHardcover: boolean; hasLang: boolean; year: number }[] = [];
  let offset = 0;
  const PAGE_SIZE = 50;
  const MAX_EDITIONS = 200;

  while (offset < MAX_EDITIONS) {
    const { entries, size } = await fetchWorkEditions(workKey, PAGE_SIZE, offset);
    if (entries.length === 0) break;

    for (const edition of entries) {
      const coverId = edition.covers?.[0];
      if (!coverId || coverId <= 0) continue;

      const langs = edition.languages?.map((l) => l.key) ?? [];
      const isEnglish = langs.length === 0 || langs.some((k) => k === "/languages/eng");
      if (!isEnglish && langs.length > 0) continue; // Skip known non-English

      const hasLang = langs.length > 0; // true = confirmed English, false = unknown language
      const format = classifyEditionFormat(edition.physical_format);
      const yearMatch = edition.publish_date?.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : 9999;

      englishCovers.push({
        coverId,
        isHardcover: format === "hardcover",
        hasLang,
        year,
      });
    }

    offset += PAGE_SIZE;
    if (offset >= size) break;
  }

  // Sort: confirmed English hardcovers first, then confirmed English any format, then unknown-lang
  englishCovers.sort((a, b) => {
    if (a.hasLang !== b.hasLang) return a.hasLang ? -1 : 1;
    if (a.isHardcover !== b.isHardcover) return a.isHardcover ? -1 : 1;
    return a.year - b.year;
  });

  return { coverId: englishCovers.length > 0 ? englishCovers[0].coverId : null };
}

export async function fetchAuthorWorks(
  authorKey: string
): Promise<OLAuthorWork[]> {
  const res = await olFetch(
    `${BASE_URL}/authors/${authorKey}/works.json?limit=50`
  );
  if (!res.ok) return [];
  const data: OLAuthorWorksResponse = await res.json();
  return data.entries ?? [];
}
