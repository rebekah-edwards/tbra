import { NextRequest } from "next/server";
import { jsonError, jsonOk } from "@/lib/api/http";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { requireApiAdmin } from "@/lib/api/admin";
import { searchISBNdb, searchISBNdbByTitle, getISBNdbCoverUrl } from "@/lib/enrichment/isbndb";
import { fetchWorkEditions } from "@/lib/openlibrary";
import { resolveBook } from "@/lib/queries/books";

interface CoverOption {
  url: string;
  source: "isbndb" | "google" | "openlibrary";
  label: string;
}

/**
 * GET /api/v1/admin/cover-editor?bookId=<id-or-slug>
 *
 * Everything the NATIVE cover picker needs in one payload: current covers,
 * external candidates (ISBNdb + Google + OL-by-ISBN — the same cascade as
 * /api/admin/covers, reusing its helpers), and the OpenLibrary edition
 * covers (the same feed the web modal loads via /api/openlibrary/editions).
 * All lookups run server-side so the app never needs isbn/OL keys.
 */
export async function GET(req: NextRequest) {
  const admin = await requireApiAdmin(req);
  if (!admin) return jsonError("Unauthorized.", 403);

  const idOrSlug = req.nextUrl.searchParams.get("bookId");
  if (!idOrSlug) return jsonError("bookId is required.", 400);
  const resolved = await resolveBook(idOrSlug);
  if (!resolved) return jsonError("Book not found.", 404);
  const book = resolved.book;

  const authorRows = (await db.all(sql`
    SELECT a.name FROM book_authors ba JOIN authors a ON a.id = ba.author_id
    WHERE ba.book_id = ${book.id} AND ba.role = 'author'
  `)) as Array<{ name: string }>;
  const authors = authorRows.map((r) => r.name).join(", ");

  const covers: CoverOption[] = [];
  const seenUrls = new Set<string>();
  const addCover = (url: string, source: CoverOption["source"], label: string) => {
    if (!url || seenUrls.has(url)) return;
    if (url.includes("placeholder") || url.includes("noimage")) return;
    seenUrls.add(url);
    covers.push({ url, source, label });
  };

  const isbn = book.isbn13 || book.isbn10;

  // Runs the same four candidate sources as /api/admin/covers, in parallel.
  const externalWork = Promise.allSettled([
    (async () => {
      if (!isbn) return;
      const hit = await searchISBNdb(isbn);
      const url = hit && getISBNdbCoverUrl(hit);
      if (url) addCover(url, "isbndb", `ISBNdb · ${isbn}`);
    })(),
    (async () => {
      const hit = await searchISBNdbByTitle(book.title, authors);
      const url = hit && getISBNdbCoverUrl(hit);
      if (url) addCover(url, "isbndb", `ISBNdb · ${hit?.title?.slice(0, 40) ?? "title match"}`);
    })(),
    (async () => {
      const query = authors ? `${book.title} ${authors}` : book.title;
      const res = await fetch(
        `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=5${
          process.env.GOOGLE_BOOKS_API_KEY ? `&key=${process.env.GOOGLE_BOOKS_API_KEY}` : ""
        }`,
        { signal: AbortSignal.timeout(5000) },
      );
      if (!res.ok) return;
      const data = await res.json();
      for (const item of data.items ?? []) {
        const url = item.volumeInfo?.imageLinks?.thumbnail
          ?.replace("http://", "https://")
          ?.replace("zoom=1", "zoom=2");
        if (url) addCover(url, "google", `Google Books · ${item.volumeInfo.title?.slice(0, 40) ?? ""}`);
      }
    })(),
    (async () => {
      if (!isbn) return;
      const res = await fetch(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`, {
        method: "HEAD",
        signal: AbortSignal.timeout(3000),
        redirect: "follow",
      });
      if (res.ok) addCover(`https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg`, "openlibrary", `OpenLibrary · ISBN ${isbn}`);
    })(),
  ]);

  // OL edition covers (flattened exactly like the web modal does).
  const olEditions: Array<{ coverId: number; title: string; format?: string; year?: string }> = [];
  const olWork = (async () => {
    if (!book.openLibraryKey) return;
    try {
      const data = await fetchWorkEditions(book.openLibraryKey, 100, 0);
      const seen = new Set<number>();
      for (const ed of data?.entries ?? []) {
        for (const cid of ed.covers ?? []) {
          if (cid > 0 && !seen.has(cid)) {
            seen.add(cid);
            olEditions.push({
              coverId: cid,
              title: ed.title,
              format: ed.physical_format,
              year: ed.publish_date,
            });
          }
        }
      }
    } catch { /* OL editions unavailable — grid just stays empty */ }
  })();

  await Promise.all([externalWork, olWork]);

  return jsonOk({
    book: {
      id: book.id,
      title: book.title,
      coverImageUrl: book.coverImageUrl,
      audiobookCoverUrl: book.audiobookCoverUrl,
    },
    external: covers,
    olEditions,
  });
}
