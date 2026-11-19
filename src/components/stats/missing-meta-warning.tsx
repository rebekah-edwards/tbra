import Link from "next/link";

export interface AdminMissing {
  year: number;
  pages: number;
  audio: number;
  /** Based Reader (not admin): links to their own list, not the catalog fixer. */
  personal?: boolean;
}

/**
 * Warning on the pages / listening totals (admins and Based Readers): some of
 * this year's reads can't count because the book has no page count or audio
 * length. Admins go to the catalog fixer (/admin/book-metadata); Based Readers
 * to their own list (/stats/missing), where entries count for them and become
 * suggestions in the admin queue.
 */
export function MissingMetaWarning({ missing, kind }: { missing: AdminMissing; kind: "pages" | "audio" }) {
  const n = kind === "pages" ? missing.pages : missing.audio;
  const label = `${n} ${n === 1 ? "book" : "books"} missing ${kind === "pages" ? "a page count" : "an audio length"} — ${missing.personal ? "add yours" : "fix"}`;
  const href = missing.personal
    ? `/stats/missing?year=${missing.year}&focus=${kind}`
    : `/admin/book-metadata?year=${missing.year}&focus=${kind}`;
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#f59e0b]/40 bg-surface/80 text-[#f59e0b] transition-colors hover:border-[#f59e0b]"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" />
        <line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    </Link>
  );
}
