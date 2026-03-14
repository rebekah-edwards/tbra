"use client";

import { useState, useMemo } from "react";
import { ReviewCard } from "@/components/review/review-card";
import type { BookReviewEntry } from "@/lib/queries/review";

interface ReviewListClientProps {
  reviews: BookReviewEntry[];
  bookId: string;
  sortBy?: "latest" | "helpful";
}

export function ReviewListClient({ reviews, bookId }: ReviewListClientProps) {
  const [hideNoText, setHideNoText] = useState(false);
  const [dnfOnly, setDnfOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"latest" | "helpful">("latest");

  const filtered = useMemo(() => {
    let result = reviews;
    if (hideNoText) {
      result = result.filter((r) => r.reviewText && r.reviewText.trim() !== "");
    }
    if (dnfOnly) {
      result = result.filter((r) => r.didNotFinish);
    }
    if (sortBy === "helpful") {
      result = [...result].sort((a, b) => b.helpfulCount - a.helpfulCount);
    }
    return result;
  }, [reviews, hideNoText, dnfOnly, sortBy]);

  if (reviews.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted text-sm">No reviews yet.</p>
        <p className="text-muted text-xs mt-1">
          Be the first to share your thoughts!
        </p>
      </div>
    );
  }

  const hasDnf = reviews.some((r) => r.didNotFinish);
  const hasTextless = reviews.some(
    (r) => !r.reviewText || r.reviewText.trim() === ""
  );

  return (
    <div className="space-y-3">
      {/* Sort + Filters */}
      <div className="flex flex-wrap items-center gap-3 pb-1">
        {/* Sort toggle */}
        <div className="flex items-center gap-1 text-xs">
          <button
            type="button"
            onClick={() => setSortBy("latest")}
            className={`px-2 py-1 rounded-full transition-colors ${
              sortBy === "latest"
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted hover:text-foreground"
            }`}
          >
            Latest
          </button>
          <button
            type="button"
            onClick={() => setSortBy("helpful")}
            className={`px-2 py-1 rounded-full transition-colors ${
              sortBy === "helpful"
                ? "bg-primary/15 text-primary font-medium"
                : "text-muted hover:text-foreground"
            }`}
          >
            Most Helpful
          </button>
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Filter checkboxes */}
        {hasTextless && (
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={hideNoText}
              onChange={(e) => setHideNoText(e.target.checked)}
              className="accent-primary w-3.5 h-3.5 rounded"
            />
            Written only
          </label>
        )}
        {hasDnf && (
          <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dnfOnly}
              onChange={(e) => setDnfOnly(e.target.checked)}
              className="accent-primary w-3.5 h-3.5 rounded"
            />
            DNF only
          </label>
        )}
      </div>

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted text-sm">
            No reviews match the current filters.
          </p>
        </div>
      ) : (
        filtered.map((review) => (
          <ReviewCard key={review.id} review={review} bookId={bookId} />
        ))
      )}
    </div>
  );
}
