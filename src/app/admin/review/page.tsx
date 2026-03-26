import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { books, bookAuthors, authors } from "@/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { BookReviewCard } from "@/components/admin/book-review-card";

export const dynamic = "force-dynamic";

export default async function AdminReviewPage() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  // Fetch books needing review, most recent first
  const flaggedBooks = await db
    .select({
      id: books.id,
      title: books.title,
      coverImageUrl: books.coverImageUrl,
      reviewReason: books.reviewReason,
      publicationYear: books.publicationYear,
      pages: books.pages,
      description: books.description,
      slug: books.slug,
      createdAt: books.createdAt,
    })
    .from(books)
    .where(eq(books.needsReview, true))
    .orderBy(desc(books.createdAt))
    .limit(100);

  // Get author names for each book
  const bookIds = flaggedBooks.map((b) => b.id);
  const authorRows = bookIds.length > 0
    ? await db
        .select({
          bookId: bookAuthors.bookId,
          authorName: authors.name,
        })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(sql`${bookAuthors.bookId} IN (${sql.join(bookIds.map(id => sql`${id}`), sql`, `)})`)
    : [];

  // Build author lookup
  const authorMap = new Map<string, string>();
  for (const row of authorRows) {
    if (!authorMap.has(row.bookId)) {
      authorMap.set(row.bookId, row.authorName);
    }
  }

  // Total count for header
  const [countResult] = await db.all<{ count: number }>(sql`
    SELECT COUNT(*) as count FROM books WHERE needs_review = 1
  `);
  const totalCount = countResult?.count ?? 0;

  const reviewBooks = flaggedBooks.map((b) => ({
    ...b,
    authorName: authorMap.get(b.id) ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1
          className="text-foreground text-2xl font-bold tracking-tight"
         
        >
          Review Queue
        </h1>
        <p className="text-sm text-muted mt-1">
          {totalCount} book{totalCount !== 1 ? "s" : ""} flagged for manual review (missing 2+ fields)
        </p>
      </div>

      {reviewBooks.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <p className="text-lg font-medium">All clear</p>
          <p className="text-sm mt-1">No books currently need review.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {reviewBooks.map((book) => (
            <BookReviewCard key={book.id} book={book} />
          ))}
        </div>
      )}
    </div>
  );
}
