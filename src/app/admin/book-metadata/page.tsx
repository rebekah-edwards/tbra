import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getMissingBookMetadata } from "@/lib/queries/missing-book-metadata";
import { MissingMetadataList } from "@/components/admin/missing-metadata-list";

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
  searchParams: Promise<{ year?: string; focus?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");

  const params = await searchParams;
  const currentYear = new Date().getFullYear();
  const parsed = parseInt(params.year ?? "", 10);
  const year = Number.isInteger(parsed) && parsed > 1900 && parsed <= currentYear ? parsed : currentYear;
  const focus = params.focus === "audio" ? "audio" : "pages";

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
        <p className="eyebrow mt-3">Admin · {year}</p>
        <h1 className="text-foreground text-2xl font-bold tracking-tight">Missing pages &amp; audio lengths</h1>
        <p className="mt-1 text-sm text-muted">
          {`Books you finished in ${year} that can’t count toward pages or listening time yet. Saving updates the book itself, for every reader.`}
        </p>
      </div>

      <MissingMetadataList missing={missing} focus={focus} />
    </div>
  );
}
