import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { db } from "@/db";
import { sql } from "drizzle-orm";
import { CoversReview } from "@/components/admin/covers-review";
import { findNytMatch } from "@/lib/enrichment/nyt";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type Tab = "priority" | "all" | "abandon" | "audiobook";

type BookRow = {
  id: string;
  title: string;
  slug: string | null;
  coverImageUrl: string | null;
  coverSource: string | null;
  authorNames: string[];
  userCount: number;
  createdAt: string;
  nytCoverUrl: string | null;
};

/**
 * Audiobook queue: books where at least one user has the AUDIOBOOK format
 * marked — as their active "reading now" format or as an owned format — but
 * no square audiobook image is uploaded yet (books.audiobook_cover_url).
 * The admin uploads these manually to save Brave API spend. The thumbnail
 * shows the regular cover as reference; `users` counts demanding readers.
 */
async function loadAudiobookQueue(offset: number): Promise<BookRow[]> {
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
    WITH demand AS MATERIALIZED (
      SELECT book_id, count(DISTINCT user_id) AS users
      FROM user_book_state
      WHERE (
        (state IN ('currently_reading', 'paused') AND active_formats LIKE '%audiobook%')
        OR owned_formats LIKE '%audiobook%'
      )
      GROUP BY book_id
    )
    SELECT
      b.id, b.title, b.slug, b.cover_image_url, b.cover_source, b.created_at,
      d.users,
      (
        SELECT group_concat(a.name, '|')
        FROM book_authors ba
        JOIN authors a ON a.id = ba.author_id
        WHERE ba.book_id = b.id
      ) as author_names
    FROM demand d
    CROSS JOIN books b ON b.id = d.book_id
    WHERE (b.audiobook_cover_url IS NULL OR b.audiobook_cover_url = '')
      AND b.visibility != 'hidden'
    ORDER BY d.users DESC, b.created_at DESC
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
    nytCoverUrl: null, // NYT covers are 2:3 — never offered for the square slot
  }));
}

/**
 * The pending set: public books with no cover. On Turso these queries took
 * 40s–4min+ and timed the page out (2026-11-19): "public AND no cover" walked
 * all ~84k public rows (wide rows, slow from cold storage) and the per-book
 * reader count scanned all of user_book_state (no book_id index). They now
 * read two indexes added by scripts/add-cover-review-indexes.ts:
 *   - idx_books_public_missing_cover: partial covering index over exactly this
 *     set, pinned with INDEXED BY because the planner otherwise prefers
 *     idx_books_visibility (keep this WHERE identical to the index's WHERE);
 *   - idx_user_book_state_book: per-book reader counts by index.
 * Rows are ranked from the index alone, and only the 50 rows on the page are
 * then fetched from books.
 */
const PENDING_FROM = `
  FROM books b INDEXED BY idx_books_public_missing_cover
  WHERE b.visibility = 'public'
    AND (b.cover_image_url IS NULL OR b.cover_image_url = '')
`;
const READERS = `(SELECT count(DISTINCT s.user_id) FROM user_book_state s WHERE s.book_id = b.id)`;

async function loadBooks(tab: Tab, offset: number): Promise<BookRow[]> {
  if (tab === "audiobook") return loadAudiobookQueue(offset);
  const activityFilter =
    tab === "priority"
      ? "WHERE users > 0"
      : tab === "abandon"
      ? "WHERE users = 0"
      : "";

  const rows = await db.all<{
    id: string;
    title: string;
    slug: string | null;
    isbn_13: string | null;
    cover_image_url: string | null;
    cover_source: string | null;
    created_at: string;
    users: number;
    author_names: string | null;
  }>(sql.raw(`
    WITH pending AS MATERIALIZED (
      SELECT b.id, b.created_at, ${READERS} AS users
      ${PENDING_FROM}
    ),
    ranked AS MATERIALIZED (
      SELECT id, created_at, users FROM pending
      ${activityFilter}
      ORDER BY users DESC, created_at DESC
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    )
    SELECT
      r.id, bk.title, bk.slug, bk.isbn_13, bk.cover_image_url, bk.cover_source,
      r.created_at, r.users,
      (
        SELECT group_concat(a.name, '|')
        FROM book_authors ba
        JOIN authors a ON a.id = ba.author_id
        WHERE ba.book_id = r.id
      ) as author_names
    FROM ranked r
    CROSS JOIN books bk ON bk.id = r.id
    ORDER BY r.users DESC, r.created_at DESC
  `));

  // Attach the NYT bestseller cover (if any) for each book — a local cache read,
  // no NYT API call. Lets the admin one-click an NYT cover from the picker.
  return Promise.all(
    rows.map(async (r) => {
      const authorNames = r.author_names ? r.author_names.split("|").filter(Boolean) : [];
      const nyt = await findNytMatch({
        isbn13: r.isbn_13,
        title: r.title,
        author: authorNames[0] ?? null,
      });
      return {
        id: r.id,
        title: r.title,
        slug: r.slug,
        coverImageUrl: r.cover_image_url,
        coverSource: r.cover_source,
        createdAt: r.created_at,
        userCount: Number(r.users ?? 0),
        authorNames,
        nytCoverUrl: nyt?.bookImage ?? null,
      };
    })
  );
}

async function loadCounts(): Promise<{ priority: number; all: number; abandon: number; audiobook: number }> {
  // Audiobook demand is gathered from user_book_state first (small) and joined
  // to books by primary key; the old EXISTS form probed every visible book.
  const rows = await db.all<{ tab: string; n: number }>(sql.raw(`
    WITH pending AS MATERIALIZED (
      SELECT ${READERS} AS users
      ${PENDING_FROM}
    ),
    audio AS MATERIALIZED (
      SELECT DISTINCT s.book_id FROM user_book_state s
      WHERE (s.state IN ('currently_reading', 'paused') AND s.active_formats LIKE '%audiobook%')
         OR s.owned_formats LIKE '%audiobook%'
    )
    SELECT 'priority' as tab, count(*) as n FROM pending WHERE users > 0
    UNION ALL
    SELECT 'all' as tab, count(*) as n FROM pending
    UNION ALL
    SELECT 'abandon' as tab, count(*) as n FROM pending WHERE users = 0
    UNION ALL
    SELECT 'audiobook' as tab, count(*) as n
    FROM audio d
    CROSS JOIN books b ON b.id = d.book_id
    WHERE (b.audiobook_cover_url IS NULL OR b.audiobook_cover_url = '')
      AND b.visibility != 'hidden'
  `));

  const map: Record<string, number> = {};
  for (const r of rows) map[r.tab] = Number(r.n);
  return {
    priority: map.priority ?? 0,
    all: map.all ?? 0,
    abandon: map.abandon ?? 0,
    audiobook: map.audiobook ?? 0,
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
  const tab: Tab =
    tabParam === "all" ? "all"
    : tabParam === "abandon" ? "abandon"
    : tabParam === "audiobook" ? "audiobook"
    : "priority";
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
