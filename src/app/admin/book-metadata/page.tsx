import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getMissingBookMetadata, getMissingMetadataQueue, MISSING_QUEUE_PAGE_SIZE } from "@/lib/queries/missing-book-metadata";
import { MissingMetadataList, MissingQueueList } from "@/components/admin/missing-metadata-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Missing pages & audio lengths | tbr*a",
  robots: { index: false },
};

/**
 * Admin-only: the books in YOUR year of reads that are missing a page count
 * (print/ebook reads) or an audio length (audiobook reads). Reached from the
 * warning icons on Stats. Saving writes the book's catalog row, so the fix is
 * permanent and helps every reader's totals.
 */
export default async function AdminBookMetadataPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; focus?: string; tab?: string; page?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const parsed = parseInt(params.year ?? "", 10);
  const year = Number.isInteger(parsed) && parsed > 1900 && parsed <= currentYear ? parsed : currentYear;
  const focus = params.focus === "audio" ? "audio" : "pages";

  const tab = params.tab === "all" ? "all" : "mine";
  const requestedPage = Math.max(1, Math.floor(Number(params.page ?? 1)) || 1);

  const tabLink = (t: "mine" | "all", f: "pages" | "audio" = focus) =>
    `/admin/book-metadata?tab=${t}&focus=${f}${t === "mine" ? `&year=${year}` : ""}`;

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-32">
      <div>
        <Link href={tab === "mine" ? `/stats?year=${year}` : "/admin"} className="inline-flex items-center gap-1 text-sm text-neon-blue hover:underline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          {tab === "mine" ? "Stats" : "Admin"}
        </Link>
        <p className="eyebrow mt-3">Admin{tab === "mine" ? ` · ${year}` : ""}</p>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">Missing pages &amp; audio lengths</h1>
        <p className="mt-1 text-sm text-muted">
          {tab === "mine"
            ? `Books you finished or are reading in ${year} that can’t count toward pages or listening time yet. Saving updates the book itself, for every reader.`
            : "Books any reader has finished, is reading, paused or DNF’d that are missing a page count (print and ebook reads) or an audio length (audiobook reads). Most-read first. Saving updates the book itself."}
        </p>
      </div>

      <div className="seg-glass max-w-sm">
        <Link href={tabLink("mine")} data-active={tab === "mine"}>Your {year}</Link>
        <Link href={tabLink("all")} data-active={tab === "all"}>All readers</Link>
      </div>

      {tab === "mine" ? (
        <MissingMetadataList missing={await getMissingBookMetadata(user.userId, year)} focus={focus} />
      ) : (
        await (async () => {
          const queue = await getMissingMetadataQueue(focus, requestedPage);
          const pages = Math.max(1, Math.ceil(queue.total / MISSING_QUEUE_PAGE_SIZE));
          const page = Math.min(requestedPage, pages);
          const pageLink = (p: number) => `/admin/book-metadata?tab=all&focus=${focus}&page=${p}`;
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="seg-glass max-w-xs flex-1">
                  <Link href={tabLink("all", "pages")} data-active={focus === "pages"}>Pages</Link>
                  <Link href={tabLink("all", "audio")} data-active={focus === "audio"}>Audio length</Link>
                </div>
                <span className="whitespace-nowrap text-xs text-muted">{queue.total.toLocaleString("en-US")} books</span>
              </div>
              {/* key: a new page or list remounts the rows' local "Saved" state. */}
              <MissingQueueList key={`${focus}-${page}`} kind={focus} books={queue.books} />
              {pages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-2 text-sm">
                  {page > 1 && <Link href={pageLink(page - 1)} className="btn-glass px-4 py-1.5">← Previous</Link>}
                  <span className="text-muted">Page {page} of {pages}</span>
                  {page < pages && <Link href={pageLink(page + 1)} className="btn-glass px-4 py-1.5">Next →</Link>}
                </div>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
}
