/**
 * Library of Congress API integration — FREE, no key needed.
 * Supplements genre/subject data. Rate limit ~20 req/sec.
 * Best for: authoritative subject classifications, publication years.
 * Weak for: modern book ISBN lookups, covers.
 */

const LOC_BASE = "https://www.loc.gov";

interface LocResult {
  subjects: string[];
  year: number | null;
  publisher: string | null;
  pages: number | null;
}

/**
 * Search Library of Congress by title + author.
 * Returns subject headings, year, publisher if found.
 */
export async function searchLibraryOfCongress(
  title: string,
  author: string
): Promise<LocResult | null> {
  try {
    const query = encodeURIComponent(`${title} ${author}`.trim());
    const res = await fetch(
      `${LOC_BASE}/books/?q=${query}&fo=json&c=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const results = data.results ?? [];
    if (results.length === 0) return null;

    // Find best match — LoC results are often noisy
    const titleLower = title.toLowerCase();
    let best = results[0];
    let bestScore = 0;

    for (const r of results) {
      const rTitle = (r.title || "").toLowerCase();
      let score = 0;
      if (rTitle.includes(titleLower.slice(0, 20))) score += 10;
      if (r.date && /\d{4}/.test(r.date)) score += 5;
      if (r.subject && r.subject.length > 0) score += 5;
      if (score > bestScore) {
        bestScore = score;
        best = r;
      }
    }

    // Only use if title seems to match
    if (bestScore < 10) return null;

    const subjects: string[] = (best.subject || [])
      .map((s: string) => s.replace(/\.$/, "").trim())
      .filter((s: string) => s.length > 2 && s.length < 60);

    let year: number | null = null;
    if (best.date) {
      const match = best.date.match(/(\d{4})/);
      if (match) {
        const y = parseInt(match[1], 10);
        if (y >= 1900 && y <= new Date().getFullYear() + 2) year = y;
      }
    }

    return {
      subjects,
      year,
      publisher: null, // LoC doesn't reliably return publisher in search results
      pages: null, // Same — not in search results
    };
  } catch {
    return null;
  }
}
