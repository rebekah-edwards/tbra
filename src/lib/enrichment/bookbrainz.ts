/**
 * BookBrainz API integration — FREE, no key needed.
 * BACKUP ONLY: used when OL + ISBNdb both fail to identify a book.
 * Good for: author disambiguation, edition identification, ISBNs.
 */

const BB_BASE = "https://bookbrainz.org";

interface BookBrainzResult {
  isbn: string | null;
  title: string | null;
  year: number | null;
}

/**
 * Search BookBrainz for a book by title + author.
 * Returns ISBN and publication year if found.
 */
export async function searchBookBrainz(
  title: string,
  author: string
): Promise<BookBrainzResult | null> {
  try {
    const query = encodeURIComponent(`${title} ${author}`.trim());
    const res = await fetch(
      `${BB_BASE}/search/search?q=${query}&type=Edition`,
      {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const results = data.results ?? [];
    if (results.length === 0) return null;

    const titleLower = title.toLowerCase();

    for (const r of results) {
      const name = (r.name || r.defaultAlias?.name || "").toLowerCase();
      if (!name.includes(titleLower.slice(0, 15))) continue;

      // Try to get ISBN from identifiers
      let isbn: string | null = null;
      if (r.identifierSet?.identifiers) {
        for (const ident of r.identifierSet.identifiers) {
          if (ident.type?.label === "ISBN-13" || ident.type?.label === "ISBN") {
            isbn = ident.value;
            break;
          }
        }
      }

      // Try to get year from release events
      let year: number | null = null;
      if (r.releaseEventSet?.releaseEvents) {
        for (const event of r.releaseEventSet.releaseEvents) {
          if (event.date) {
            const match = event.date.match(/(\d{4})/);
            if (match) {
              year = parseInt(match[1], 10);
              break;
            }
          }
        }
      }

      return { isbn, title: r.name || null, year };
    }

    return null;
  } catch {
    return null;
  }
}
