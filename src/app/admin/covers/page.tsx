import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { CoversReview } from "@/components/admin/covers-review";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Tab = "priority" | "all" | "abandon";

type BookRow = {
  id: string;
  title: string;
  slug: string | null;
  coverImageUrl: string | null;
  coverSource: string | null;
  authorNames: string[];
  userCount: number;
  createdAt: string;
};

async function loadBooks(tab: Tab, offset: number): Promise<BookRow[]> {
  const activityFilter =
    tab === "priority"
      ? "HAVING users > 0"
      : tab === "abandon"
      ? "HAVING users = 0"
      : "";

  const rows = await db.all<{
    id: string;
    title: string;
    slug: string | null;
    cover_image_url: string | null;
    cover_source: string | null;
    created_at: string;
    users: number;
    author_names: string | null;
  }>(sql.raw(`
    SELECT
      b.id,
      b.title,
      b.slug,
      b.cover_image_url,
      b.cover_source,
      b.created_at,
      (SELECT count(DISTINCT user_id) FROM user_book_state WHERE book_id = b.id) as users,
      (
        SELECT group_concat(a.name, '|')
        FROM book_authors ba
        JOIN authors a ON a.id = ba.author_id
        WHERE ba.book_id = b.id
        ORDER BY ba.author_order
      ) as author_names
    FROM books b
    WHERE b.visibility = 'public'
      AND (b.cover_image_url IS NULL OR b.cover_image_url = '')
    ${activityFilter}
    ORDER BY users DESC, b.created_at DESC
    LIMIT ${PAGE_SIZE} OFFSET ${offset}
  `));

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    slug: r.slug,
    coverImageUrl: r.cover_image_url,
    coverSource: r.cover_source,
    createdAt: r.created_at,
    userCount: Number(r.users ?? 0),
    authorNames: r.author_names ? r.author_names.split("|").filter(Boolean) : [],
  }));
}

async function loadCounts(): Promise<{ priority: number; all: number; abandon: number }> {
  const rows = await db.all<{ tab: string; n: number }>(sql.raw(`
    WITH pending AS (
      SELECT
        b.id,
        (SELECT count(DISTINCT user_id) FROM user_book_state WHERE book_id = b.id) as users
      FROM books b
      WHERE b.visibility = 'public'
        AND (b.cover_image_url IS NULL OR b.cover_image_url = '')
    )
    SELECT 'priority' as tab, count(*) as n FROM pending WHERE users > 0
    UNION ALL
    SELECT 'all' as tab, count(*) as n FROM pending
    UNION ALL
    SELECT 'abandon' as tab, count(*) as n FROM pending WHERE users = 0
  `));

  const map: Record<string, number> = {};
  for (const r of rows) map[r.tab] = Number(r.n);
  return {
    priority: map.priority ?? 0,
    all: map.all ?? 0,
    abandon: map.abandon ?? 0,
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
