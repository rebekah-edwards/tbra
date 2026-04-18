import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { books, bookAuthors, authors, userBookState } from "@/db/schema";
import { and, eq, isNull, or, sql, desc } from "drizzle-orm";
import { CoversReview } from "@/components/admin/covers-review";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Tab = "priority" | "all" | "abandon";

async function loadBooks(tab: Tab, offset: number) {
  // Books missing covers OR cleared (cover_source='isbndb-placeholder-cleared'
  // or 'none-found'). Books with manual/ol/isbndb/etc sources + a URL are out.
  const missingOrCleared = or(
    isNull(books.coverImageUrl),
    eq(books.coverImageUrl, ""),
  );

  // Count user activity per book (to bucket priority vs abandon)
  const activityCounts = db
    .select({
      bookId: userBookState.bookId,
      n: sql<number>`count(distinct ${userBookState.userId})`.as("n"),
    })
    .from(userBookState)
    .groupBy(userBookState.bookId)
    .as("activity");

  let whereClause;
  if (tab === "priority") {
    whereClause = and(
      eq(books.visibility, "public"),
      missingOrCleared,
      sql`${activityCounts.n} > 0`,
    );
  } else if (tab === "abandon") {
    whereClause = and(
      eq(books.visibility, "public"),
      missingOrCleared,
      isNull(activityCounts.bookId),
    );
  } else {
    // all
    whereClause = and(eq(books.visibility, "public"), missingOrCleared);
  }

  const rows = await db
    .select({
      id: books.id,
      title: books.title,
      slug: books.slug,
      coverImageUrl: books.coverImageUrl,
      coverSource: books.coverSource,
      createdAt: books.createdAt,
      users: sql<number>`coalesce(${activityCounts.n}, 0)`,
    })
    .from(books)
    .leftJoin(activityCounts, eq(books.id, activityCounts.bookId))
    .where(whereClause)
    .orderBy(desc(sql`coalesce(${activityCounts.n}, 0)`), desc(books.createdAt))
    .limit(PAGE_SIZE)
    .offset(offset);

  // Fetch authors per book (second query — Drizzle can't easily aggregate string_agg)
  const bookIds = rows.map((r) => r.id);
  const authorRows = bookIds.length
    ? await db
        .select({
          bookId: bookAuthors.bookId,
          authorName: authors.name,
          authorOrder: bookAuthors.authorOrder,
        })
        .from(bookAuthors)
        .innerJoin(authors, eq(bookAuthors.authorId, authors.id))
        .where(
          sql`${bookAuthors.bookId} in (${sql.join(
            bookIds.map((id) => sql`${id}`),
            sql`, `,
          )})`,
        )
    : [];

  const authorsByBook = new Map<string, string[]>();
  for (const r of authorRows) {
    const list = authorsByBook.get(r.bookId) ?? [];
    list[r.authorOrder ?? list.length] = r.authorName;
    authorsByBook.set(r.bookId, list);
  }

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    coverImageUrl: r.coverImageUrl,
    coverSource: r.coverSource,
    authorNames: (authorsByBook.get(r.id) ?? []).filter(Boolean),
    userCount: Number(r.users ?? 0),
    createdAt: r.createdAt,
  }));
}

async function loadCounts() {
  const activityCounts = db
    .select({
      bookId: userBookState.bookId,
      n: sql<number>`count(distinct ${userBookState.userId})`.as("n"),
    })
    .from(userBookState)
    .groupBy(userBookState.bookId)
    .as("activity");

  const missingOrCleared = or(
    isNull(books.coverImageUrl),
    eq(books.coverImageUrl, ""),
  );

  const [priorityRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(books)
    .leftJoin(activityCounts, eq(books.id, activityCounts.bookId))
    .where(
      and(eq(books.visibility, "public"), missingOrCleared, sql`${activityCounts.n} > 0`),
    );
  const [allRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(books)
    .where(and(eq(books.visibility, "public"), missingOrCleared));
  const [abandonRow] = await db
    .select({ n: sql<number>`count(*)` })
    .from(books)
    .leftJoin(activityCounts, eq(books.id, activityCounts.bookId))
    .where(
      and(
        eq(books.visibility, "public"),
        missingOrCleared,
        isNull(activityCounts.bookId),
      ),
    );

  return {
    priority: Number(priorityRow?.n ?? 0),
    all: Number(allRow?.n ?? 0),
    abandon: Number(abandonRow?.n ?? 0),
  };
}

export default async function AdminCoversPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  const { tab: tabParam, page: pageParam } = await searchParams;
  const tab: Tab = tabParam === "all" ? "all" : tabParam === "abandon" ? "abandon" : "priority";
  const page = Math.max(1, Number(pageParam ?? 1) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const [booksList, counts] = await Promise.all([loadBooks(tab, offset), loadCounts()]);

  return (
    <div className="space-y-6 lg:w-[60%] lg:mx-auto">
      <div>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          Cover review
        </h1>
        <p className="text-sm text-muted mt-1">
          Books missing a cover, waiting for a manual replacement. Paste an
          Amazon cover URL and save, or archive the book if it&apos;s not worth
          tracking.
        </p>
      </div>

      <CoversReview
        books={booksList}
        counts={counts}
        activeTab={tab}
        page={page}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
