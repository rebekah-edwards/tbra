"use client";

import { useState, useMemo } from "react";
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
    <span className="text-xs text-primary">
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
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted"
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
              className="w-full rounded-lg border border-border bg-surface pl-9 pr-4 py-2 text-xs placeholder-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          {/* Filter tags */}
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => { setActiveFilter("all"); setShowAll(false); }}
              className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                activeFilter === "all"
                  ? "bg-primary/20 text-primary"
                  : "bg-surface border border-border text-muted hover:text-foreground"
              }`}
            >
              All
            </button>
            {hasWritten && (
              <button
                type="button"
                onClick={() => { setActiveFilter(activeFilter === "written" ? "all" : "written"); setShowAll(true); }}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  activeFilter === "written"
                    ? "bg-neon-blue/20"
                    : "bg-surface border border-border text-muted hover:text-foreground"
                }`}
              >
                Written reviews
              </button>
            )}
            {hasDnf && (
              <button
                type="button"
                onClick={() => { setActiveFilter(activeFilter === "dnf" ? "all" : "dnf"); setShowAll(true); }}
                className={`rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors ${
                  activeFilter === "dnf"
                    ? "bg-destructive/20 text-destructive"
                    : "bg-surface border border-border text-muted hover:text-foreground"
                }`}
              >
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
              className="flex gap-3 rounded-lg border border-border bg-surface p-3 hover:border-primary/30 hover:bg-surface-alt transition-all duration-200 group"
            >
              <div className="relative flex-shrink-0">
                {review.coverImageUrl ? (
                  <Image
                    src={review.coverImageUrl}
                    alt={`Cover of ${review.title}`}
                    width={40}
                    height={60}
                    className="h-[60px] w-[40px] rounded object-cover group-hover:shadow-md transition-shadow"
                  />
                ) : (
                  <NoCover title={review.title} className="h-[60px] w-[40px]" size="sm" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-semibold leading-tight line-clamp-1">{review.title}</h4>
                  {review.didNotFinish && (
                    <span className="inline-flex items-center rounded-full bg-destructive/15 px-1.5 py-0.5 text-[9px] font-bold text-destructive whitespace-nowrap">
                      DNF{review.dnfPercentComplete ? ` at ${review.dnfPercentComplete}%` : ""}
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted line-clamp-1">{review.authors.join(", ")}</p>
                <div className="flex items-center gap-2 mt-1">
                  {review.rating && <StarRating rating={review.rating} />}
                  <span className="text-[10px] text-muted">
                    {new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
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
          className="mt-3 w-full text-center text-sm text-primary hover:text-primary/80 font-medium py-2"
        >
          Show all {filtered.length} reviews
        </button>
      )}
    </section>
  );
}
