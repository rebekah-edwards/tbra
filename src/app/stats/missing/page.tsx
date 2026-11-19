import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin, isPremium } from "@/lib/auth";
import { getMissingBookMetadata } from "@/lib/queries/missing-book-metadata";
import { MissingMetadataList } from "@/components/admin/missing-metadata-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Missing pages & audio lengths | tbr*a",
  robots: { index: false },
};

/**
 * Based Readers (2026-11-19): the books in your year of reads that are missing
 * a page count or audio length. What you enter counts toward your own goals
 * right away and is sent to the tbr*a team as a suggestion for the book.
 * Admins fix the catalog itself on /admin/book-metadata instead.
 */
export default async function MissingForMePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; focus?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const parsed = parseInt(params.year ?? "", 10);
  const year = Number.isInteger(parsed) && parsed > 1900 && parsed <= currentYear ? parsed : currentYear;
  const focus = params.focus === "audio" ? "audio" : "pages";
  if (isAdmin(user)) redirect(`/admin/book-metadata?year=${year}&focus=${focus}`);
  if (!isPremium(user)) redirect("/stats");

  const missing = await getMissingBookMetadata(user.userId, year);

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-32">
      <div>
        <Link href={`/stats?year=${year}`} className="inline-flex items-center gap-1 text-sm text-neon-blue hover:underline">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <polyline points="15 18 9 12 15 6" />
          </svg>
          Stats
        </Link>
        <p className="eyebrow mt-3">{year}</p>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">Missing pages &amp; audio lengths</h1>
        <p className="mt-1 text-sm text-muted">
          {`These books don’t have a page count or audiobook length on file yet, so they can’t count toward your pages or listening goals. Add the number from your copy — it counts for you right away, and we’ll use it to fix the book for everyone.`}
        </p>
      </div>
      <MissingMetadataList missing={missing} focus={focus} mode="personal" />
    </div>
  );
}
