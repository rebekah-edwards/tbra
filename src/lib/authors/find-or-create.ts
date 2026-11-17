/**
 * The one way to get an `authors` row for a name.
 *
 * Every importer, enrichment phase and script used to carry its own copy of
 * this lookup, and none of them normalised the name — so a source that files
 * people as "Yarros, Rebecca" created a second author beside "Rebecca Yarros".
 * Routing all of them through here means the stored name is always the
 * normalised "First Last" form (see src/lib/text/author-name.ts).
 *
 * Deliberately free of Next.js imports so standalone scripts
 * (nightly-import, upcoming-releases, …) can use it too.
 */
import { db } from "@/db";
import { authors } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { normalizeAuthorName } from "@/lib/text/author-name";

export async function findOrCreateAuthor(rawName: string, olKey?: string | null): Promise<string> {
  const name = normalizeAuthorName(rawName) || rawName.trim();

  let author = await db.query.authors.findFirst({ where: eq(authors.name, name) });
  if (!author) {
    // Same name in different case ("KING, Joe" → "Joe King" vs "Joe king").
    author = await db.query.authors.findFirst({
      where: sql`${authors.name} = ${name} COLLATE NOCASE`,
    });
  }
  if (!author) {
    // Same initials, different spacing: "J. R. R. Tolkien" vs "J.R.R. Tolkien".
    // Catalogue sources space them, retail sources do not — try both spellings
    // before minting a second row for the same person.
    const compact = name.replace(/(\p{Lu}\.)\s+(?=\p{Lu}\.)/gu, "$1");
    const spaced = name.replace(/(\p{Lu}\.)(?=\p{Lu}\.)/gu, "$1 ");
    for (const variant of [compact, spaced]) {
      if (variant === name) continue;
      author = await db.query.authors.findFirst({
        where: sql`${authors.name} = ${variant} COLLATE NOCASE`,
      });
      if (author) break;
    }
  }
  if (author) {
    // Backfill the OL key if we have one and the row does not.
    if (olKey && !author.openLibraryKey) {
      await db.update(authors).set({ openLibraryKey: olKey }).where(eq(authors.id, author.id));
    }
    return author.id;
  }

  const [created] = await db
    .insert(authors)
    .values({ name, openLibraryKey: olKey ?? null })
    .returning();
  return created.id;
}
