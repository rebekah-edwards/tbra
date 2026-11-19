"use client";

import { useState, useMemo } from "react";
import { parseDbDate } from "@/lib/date-utils";
import Link from "next/link";
import Image from "next/image";
import { stripHtml } from "@/lib/text-utils";
import type { UserReviewWithBook } from "@/lib/queries/user-reviews";
import { NoCover } from "@/components/no-cover";

interface PublicReviewHistoryProps {
  reviews: UserReviewWithBook[];
}

function StarRating({ rating }: { rating: number }) {
  const fullStars = Math.floor(rating);
  const hasHalf = rating - fullStars >= 0.25;

  return (
    <span className="text-xs text-neon-blue">
      {"★".repeat(fullStars)}
      {hasHalf && "½"}
    </span>
  );
}

type FilterTag = "all" | "dnf" | "written";

export function PublicReviewHistory({ reviews }: PublicReviewHistoryProps) {
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterTag>("all");

  const hasDnf = reviews.some((r) => r.didNotFinish);
  const hasWritten = reviews.some((r) => r.reviewText);

  // Client-side search + tag filter
  const filtered = useMemo(() => {
    let result = reviews;

    // Tag filters
    if (activeFilter === "dnf") {
      result = result.filter((r) => r.didNotFinish);
    } else if (activeFilter === "written") {
      result = result.filter((r) => r.reviewText);
    }

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.authors.some((a) => a.toLowerCase().includes(q)) ||
          (r.reviewText && stripHtml(r.reviewText).toLowerCase().includes(q))
      );
    }

    return result;
  }, [reviews, search, activeFilter]);

  const visible = showAll ? filtered : filtered.slice(0, 5);

  if (reviews.length === 0) {
    return (
      <section>
        <h2
          className="section-heading text-sm mb-3"
        >
          Reviews
        </h2>
        <p className="text-sm text-muted">No reviews yet.</p>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2
          className="section-heading text-sm"
        >
          Reviews ({reviews.length})
        </h2>
      </div>

      {/* Search bar + filter tags */}
      {reviews.length > 3 && (
        <div className="space-y-2 mb-3">
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 h-3.5 w-3.5 text-muted"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setShowAll(true);
              }}
              placeholder="Search reviews..."
              className="field-glass !h-10 w-full !pl-10 text-sm"
            />
          </div>

          {/* Filter tags */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => { setActiveFilter("all"); setShowAll(false); }}
              data-active={activeFilter === "all" ? "true" : undefined}
              className="btn-glass cursor-pointer px-3 py-1 text-[11px]"
            >
              All
            </button>
            {hasWritten && (
              <button
                type="button"
                onClick={() => { setActiveFilter(activeFilter === "written" ? "all" : "written"); setShowAll(true); }}
                data-active={activeFilter === "written" ? "true" : undefined}
                style={{ "--ring": "var(--neon-blue)" } as React.CSSProperties}
                className="btn-glass cursor-pointer px-3 py-1 text-[11px]"
              >
                <span className="h-[6px] w-[6px] rounded-full bg-neon-blue" aria-hidden="true" />
                Written reviews
              </button>
            )}
            {hasDnf && (
              <button
                type="button"
                onClick={() => { setActiveFilter(activeFilter === "dnf" ? "all" : "dnf"); setShowAll(true); }}
                data-active={activeFilter === "dnf" ? "true" : undefined}
                style={{ "--ring": "var(--destructive)" } as React.CSSProperties}
                className="btn-glass cursor-pointer px-3 py-1 text-[11px]"
              >
                <span className="h-[6px] w-[6px] rounded-full bg-destructive" aria-hidden="true" />
                DNF
              </button>
            )}
          </div>
        </div>
      )}

      {filtered.length === 0 && (search.trim() || activeFilter !== "all") ? (
        <p className="text-sm text-muted py-4 text-center">
          {search.trim() ? `No reviews match "${search}"` : "No reviews in this category."}
        </p>
      ) : (
        <div className="space-y-3">
          {visible.map((review) => (
            <Link
              key={review.reviewId}
              href={`/book/${review.bookSlug || review.bookId}/reviews#review-${review.reviewId}`}
              className="group flex gap-3 rounded-[18px] border border-foreground/10 bg-surface/60 p-3 backdrop-blur-md transition-colors hover:border-foreground/25"
            >
              <div className="relative flex-shrink-0">
                {review.coverImageUrl ? (
                  <Image
                    src={review.coverImageUrl}
                    alt={`Cover of ${review.title}`}
                    width={40}
                    height={60}
                    className="h-[60px] w-[40px] rounded-md object-cover shadow-md ring-1 ring-white/10"
                  />
                ) : (
                  <NoCover title={review.title} className="h-[60px] w-[40px]" size="sm" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold leading-tight line-clamp-1">{review.title}</h4>
                  {review.didNotFinish && (
                    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-foreground/12 bg-surface/70 px-1.5 py-0.5 text-[9px] font-bold text-foreground">
                      <span className="h-[5px] w-[5px] rounded-full bg-destructive" aria-hidden="true" />
                      DNF{review.dnfPercentComplete ? ` at ${review.dnfPercentComplete}%` : ""}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted line-clamp-1">{review.authors.join(", ")}</p>
                <div className="flex items-center gap-2 mt-1">
                  {review.rating && <StarRating rating={review.rating} />}
                  <span className="text-[10px] text-muted">
                    {parseDbDate(review.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {review.reviewText && (
                  <p className="text-xs text-muted mt-1 line-clamp-2">{stripHtml(review.reviewText)}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}

      {!showAll && filtered.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="mt-3 w-full text-center text-sm text-neon-blue hover:text-neon-blue/80 font-medium py-2"
        >
          Show all {filtered.length} reviews
        </button>
      )}
    </section>
  );
}
