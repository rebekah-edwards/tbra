const BASE_URL = "https://openlibrary.org";
const COVERS_URL = "https://covers.openlibrary.org";
const USER_AGENT = "tbra/0.1.0 (https://github.com/rebekah-edwards/tbra)";

export interface OLSearchResult {
  key: string; // e.g. "/works/OL12345W"
  title: string;
  author_name?: string[];
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
}

async function olFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    next: { revalidate: 3600 },
  });
}

export async function searchOpenLibrary(
  query: string,
  limit = 10
): Promise<OLSearchResult[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
    fields: "key,title,author_name,first_publish_year,cover_i,isbn,number_of_pages_median",
  });
  const res = await olFetch(`${BASE_URL}/search.json?${params}`);
  if (!res.ok) return [];
  const data: OLSearchResponse = await res.json();
  return data.docs;
}

export async function fetchOpenLibraryWork(
  workKey: string
): Promise<{ description: string | null; coverId: number | null }> {
  const res = await olFetch(`${BASE_URL}${workKey}.json`);
  if (!res.ok) return { description: null, coverId: null };
  const data: OLWorkResponse = await res.json();
  return {
    description: extractDescription(data.description),
    coverId: data.covers?.[0] ?? null,
  };
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
