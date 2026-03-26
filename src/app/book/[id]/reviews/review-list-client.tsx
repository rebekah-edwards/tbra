"use client";

import { useState, useMemo, useEffect } from "react";
import { ReviewCard } from "@/components/review/review-card";
import type { BookReviewEntry } from "@/lib/queries/review";

interface ReviewListClientProps {
  reviews: BookReviewEntry[];
  bookId: string;
  currentUserId?: string | null;
  sortBy?: "latest" | "helpful";
}

export function ReviewListClient({ reviews, bookId, currentUserId }: ReviewListClientProps) {
  const [hideNoText, setHideNoText] = useState(false);
  const [dnfOnly, setDnfOnly] = useState(false);
  const [sortBy, setSortBy] = useState<"latest" | "helpful">("latest");

  // Scroll to a specific review if hash is present
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && hash.startsWith("#review-")) {
      // Small delay to ensure DOM is rendered
      const timer = setTimeout(() => {
        const el = document.getElementById(hash.slice(1));
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          // Brief highlight flash
          el.classList.add("ring-2", "ring-purple-400/50");
          setTimeout(() => el.classList.remove("ring-2", "ring-purple-400/50"), 2000);
        }
      }, 100);
      return () => clearTimeout(timer);
    }
  }, []);

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
      <div className="flex items-center justify-between pb-1">
        {/* Segmented control for sort */}
        <div className="inline-flex rounded-lg bg-surface-alt border border-border/50 p-0.5">
          <button
            type="button"
            onClick={() => setSortBy("latest")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              sortBy === "latest"
                ? "bg-purple-500/20 text-purple-400 font-medium shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Latest
          </button>
          <button
            type="button"
            onClick={() => setSortBy("helpful")}
            className={`text-xs px-3 py-1.5 rounded-md transition-colors ${
              sortBy === "helpful"
                ? "bg-purple-500/20 text-purple-400 font-medium shadow-sm"
                : "text-muted hover:text-foreground"
            }`}
          >
            Top
          </button>
        </div>

        {/* Filter buttons — outlined, fill on select */}
        {(hasTextless || hasDnf) && (
          <div className="flex items-center gap-2">
            {hasTextless && (
              <button
                type="button"
                onClick={() => setHideNoText(!hideNoText)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors border ${
                  hideNoText
                    ? "border-purple-400/50 bg-purple-500/15 text-purple-400 font-medium"
                    : "border-border/50 text-muted hover:text-foreground hover:border-border"
                }`}
              >
                {hideNoText && <span className="mr-1">✕</span>}Written
              </button>
            )}
            {hasDnf && (
              <button
                type="button"
                onClick={() => setDnfOnly(!dnfOnly)}
                className={`text-xs px-3 py-1.5 rounded-full transition-colors border ${
                  dnfOnly
                    ? "border-purple-400/50 bg-purple-500/15 text-purple-400 font-medium"
                    : "border-border/50 text-muted hover:text-foreground hover:border-border"
                }`}
              >
                {dnfOnly && <span className="mr-1">✕</span>}DNF only
              </button>
            )}
          </div>
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
          <ReviewCard key={review.id} review={review} bookId={bookId} isOwnReview={!!currentUserId && review.userId === currentUserId} />
        ))
      )}
    </div>
  );
}
