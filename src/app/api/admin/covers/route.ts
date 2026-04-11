import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { searchISBNdb, searchISBNdbByTitle, getISBNdbCoverUrl } from "@/lib/enrichment/isbndb";

interface CoverOption {
  url: string;
  source: "isbndb" | "google" | "openlibrary";
  label: string;
}

/**
 * Admin-only endpoint: fetch alternative cover images for a book from
 * ISBNdb and Google Books. Used by the admin cover editor to show
 * cover options when the current cover is missing or wrong.
 *
 * Does NOT modify any data — purely a read/lookup endpoint.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const isbn13 = request.nextUrl.searchParams.get("isbn13");
  const isbn10 = request.nextUrl.searchParams.get("isbn10");
  const title = request.nextUrl.searchParams.get("title");
  const authors = request.nextUrl.searchParams.get("authors");

  const covers: CoverOption[] = [];
  const seenUrls = new Set<string>();

  function addCover(url: string, source: CoverOption["source"], label: string) {
    if (!url || seenUrls.has(url)) return;
    if (url.includes("placeholder") || url.includes("noimage")) return;
    seenUrls.add(url);
    covers.push({ url, source, label });
  }

  // 1. ISBNdb lookup by ISBN (most reliable)
  const isbn = isbn13 || isbn10;
  if (isbn) {
    try {
      const book = await searchISBNdb(isbn);
      if (book) {
        const coverUrl = getISBNdbCoverUrl(book);
        if (coverUrl) {
          addCover(coverUrl, "isbndb", `ISBNdb · ${isbn}`);
        }
      }
    } catch { /* ISBNdb lookup failed — continue */ }
  }

  // 2. ISBNdb search by title+author (finds other editions)
  if (title) {
    try {
      const book = await searchISBNdbByTitle(title, authors ?? "");
      if (book) {
        const coverUrl = getISBNdbCoverUrl(book);
        if (coverUrl) {
          addCover(coverUrl, "isbndb", `ISBNdb · ${book.title?.slice(0, 40) ?? "title match"}`);
        }
      }
    } catch { /* ISBNdb title search failed — continue */ }
  }

  // 3. Google Books lookup (free, no key needed for basic queries)
  if (title) {
    try {
      const query = authors
        ? `${title} ${authors}`
        : title;
      const gbRes = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5${
          process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : ""
        }`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (gbRes.ok) {
        const gbData = await gbRes.json();
        for (const item of gbData.items ?? []) {
          const vol = item.volumeInfo;
          // Get the highest-res cover available
          const coverUrl = vol?.imageLinks?.thumbnail
            ?.replace("http://", "https://")
            ?.replace("zoom=1", "zoom=2");
          if (coverUrl) {
            const label = `Google Books · ${vol.title?.slice(0, 40) ?? ""}`;
            addCover(coverUrl, "google", label);
          }
        }
      }
    } catch { /* Google Books failed — continue */ }
  }

  // 4. OpenLibrary covers by ISBN (different from editions API — simpler)
  if (isbn) {
    try {
      const olUrl = `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
      const olRes = await fetch(olUrl, {
        method: "HEAD",
        signal: AbortSignal.timeout(3000),
        redirect: "follow",
      });
      // OL returns 404 for missing covers when default=false
      if (olRes.ok) {
        addCover(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`, "openlibrary", `OpenLibrary · ISBN ${isbn}`);
      }
    } catch { /* OL cover check failed */ }
  }

  return NextResponse.json({ covers });
}
