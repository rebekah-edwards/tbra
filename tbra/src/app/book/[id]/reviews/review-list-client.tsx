"use client";

import { ReviewCard } from "@/components/review/review-card";
import type { BookReviewEntry } from "@/lib/queries/review";

interface ReviewListClientProps {
  reviews: BookReviewEntry[];
}

export function ReviewListClient({ reviews }: ReviewListClientProps) {
  if (reviews.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-muted text-sm">No reviews yet.</p>
        <p className="text-muted text-xs mt-1">Be the first to share your thoughts!</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviews.map((review) => (
        <ReviewCard key={review.id} review={review} />
      ))}
    </div>
  );
}
