"use client";

import { useState, useMemo } from "react";
import { ReviewCard } from "@/components/review/review-card";
import type { BookReviewEntry } from "@/lib/queries/review";

interface ReviewListClientProps {
  reviews: BookReviewEntry[];
}

export function ReviewListClient({ reviews }: ReviewListClientProps) {
  const [hideNoText, setHideNoText] = useState(false);
  const [dnfOnly, setDnfOnly] = useState(false);

  const filtered = useMemo(() => {
    let result = reviews;
    if (hideNoText) {
      result = result.filter((r) => r.reviewText && r.reviewText.trim() !== "");
    }
    if (dnfOnly) {
      result = result.filter((r) => r.didNotFinish);
    }
    return result;
  }, [reviews, hideNoText, dnfOnly]);

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
      {/* Filters */}
      {(hasDnf || hasTextless) && (
        <div className="flex flex-wrap gap-3 pb-1">
          {hasTextless && (
            <label className="flex items-center gap-2 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={hideNoText}
                onChange={(e) => setHideNoText(e.target.checked)}
                className="accent-primary w-3.5 h-3.5 rounded"
              />
              Written reviews only
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
      )}

      {/* Results */}
      {filtered.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted text-sm">
            No reviews match the current filters.
          </p>
        </div>
      ) : (
        filtered.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))
      )}
    </div>
  );
}
