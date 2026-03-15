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

export async function searchOpenLibrary(
  query: string,
  limit = 20
): Promise<OLSearchResult[]> {
  const trimmed = query.trim();
  const params = new URLSearchParams({
    q: trimmed,
    limit: String(limit),
    fields: "key,title,author_name,author_key,first_publish_year,cover_i,isbn,number_of_pages_median",
    sort: "editions",
  });
  const res = await olFetch(`${BASE_URL}/search.json?${params}`);
  if (!res.ok) return [];
  const data: OLSearchResponse = await res.json();

  // Re-rank: boost exact/near title matches to the top
  const queryLower = trimmed.toLowerCase();
  const results = data.docs;
  results.sort((a, b) => {
    const aTitle = a.title.toLowerCase();
    const bTitle = b.title.toLowerCase();
    const aExact = aTitle === queryLower ? 0 : aTitle.includes(queryLower) ? 1 : 2;
    const bExact = bTitle === queryLower ? 0 : bTitle.includes(queryLower) ? 1 : 2;
    return aExact - bExact;
  });

  return results;
}

export async function fetchOpenLibraryWork(
  workKey: string
): Promise<{ description: string | null; coverId: number | null; subjects: string[] }> {
  const res = await olFetch(`${BASE_URL}${workKey}.json`);
  if (!res.ok) return { description: null, coverId: null, subjects: [] };
  const data: OLWorkResponse = await res.json();
  return {
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
