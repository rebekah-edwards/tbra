"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type ReviewBook = {
  id: string;
  title: string;
  authorName: string | null;
  coverImageUrl: string | null;
  reviewReason: string | null;
  publicationYear: number | null;
  pages: number | null;
  description: string | null;
  slug: string | null;
};

export function BookReviewCard({ book }: { book: ReviewBook }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [year, setYear] = useState(book.publicationYear?.toString() ?? "");
  const [pages, setPages] = useState(book.pages?.toString() ?? "");
  const [description, setDescription] = useState(book.description ?? "");
  const [saved, setSaved] = useState(false);

  const missingItems = book.reviewReason?.replace("missing: ", "").split(", ") ?? [];

  async function handleSave() {
    const updates: Record<string, unknown> = {};
    if (year && !book.publicationYear) updates.publicationYear = parseInt(year);
    if (pages && !book.pages) updates.pages = parseInt(pages);
    if (description && !book.description) updates.description = description;

    const res = await fetch("/api/admin/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bookId: book.id, updates }),
    });
    if (res.ok) setSaved(true);
  }

  async function handleMarkReviewed() {
    const updates: Record<string, unknown> = {};
    if (year) updates.publicationYear = parseInt(year);
    if (pages) updates.pages = parseInt(pages);
    if (description) updates.description = description;

    const res = await fetch("/api/admin/review", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookId: book.id,
        updates: Object.keys(updates).length > 0 ? updates : undefined,
        markReviewed: true,
      }),
    });
    if (res.ok) {
      startTransition(() => {
        router.refresh();
      });
    }
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4 space-y-3">
      <div className="flex gap-4">
        {/* Cover thumbnail */}
        <div className="w-16 h-24 flex-shrink-0 rounded-md overflow-hidden bg-surface-alt">
          {book.coverImageUrl ? (
            <img
              src={book.coverImageUrl}
              alt={book.title}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-muted text-xs">
              No cover
            </div>
          )}
        </div>

        {/* Book info */}
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground truncate">{book.title}</h3>
          <p className="text-sm text-muted">
            {book.authorName ?? "Unknown author"}
          </p>
          <div className="flex flex-wrap gap-1.5 mt-2">
            {missingItems.map((item) => (
              <span
                key={item}
                className="inline-block px-2 py-0.5 rounded-full text-[11px] font-medium bg-red-500/10 text-red-500 dark:bg-red-500/20"
              >
                {item}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Editable fields for missing data */}
      <div className="space-y-2 pt-2 border-t border-border">
        {missingItems.includes("year") && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted w-20 flex-shrink-0">Year</label>
            <input
              type="number"
              value={year}
              onChange={(e) => setYear(e.target.value)}
              placeholder="e.g. 2024"
              className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[#a3e635]/50"
            />
          </div>
        )}
        {missingItems.includes("pages") && (
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted w-20 flex-shrink-0">Pages</label>
            <input
              type="number"
              value={pages}
              onChange={(e) => setPages(e.target.value)}
              placeholder="e.g. 320"
              className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[#a3e635]/50"
            />
          </div>
        )}
        {missingItems.includes("description") && (
          <div className="flex items-start gap-2">
            <label className="text-xs text-muted w-20 flex-shrink-0 pt-1.5">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Book description..."
              rows={3}
              className="flex-1 rounded-lg border border-border bg-surface-alt px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-[#a3e635]/50 resize-none"
            />
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-surface-alt text-foreground hover:bg-border transition-colors disabled:opacity-50"
        >
          {saved ? "Saved" : "Save Edits"}
        </button>
        <button
          onClick={handleMarkReviewed}
          disabled={isPending}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[#a3e635] text-black hover:bg-[#a3e635]/90 transition-colors disabled:opacity-50"
        >
          {isPending ? "Clearing..." : "Mark Reviewed"}
        </button>
        {book.slug && (
          <Link
            href={`/book/${book.slug}`}
            className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg text-muted hover:text-foreground transition-colors"
          >
            Open Book Page
          </Link>
        )}
      </div>
    </div>
  );
}
