"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StarRow } from "./rounded-star";
import { ReviewWizard } from "./review-wizard";
import type { UserReview } from "@/lib/queries/review";

interface ReviewTriggerProps {
  bookId: string;
  bookPages?: number | null;
  userReview: UserReview | null;
  aggregate: { average: number; count: number } | null;
  isLoggedIn: boolean;
  autoOpen?: boolean;
}

export function ReviewTrigger({
  bookId,
  bookPages,
  userReview,
  aggregate,
  isLoggedIn,
  autoOpen = false,
}: ReviewTriggerProps) {
  const [wizardOpen, setWizardOpen] = useState(autoOpen);
  const router = useRouter();

  const handleOpen = () => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    setWizardOpen(true);
  };

  const displayRating = userReview?.overallRating ?? 0;

  return (
    <div className="mt-6 flex flex-col items-center gap-1">
      {/* Tappable rating display */}
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-2 group"
      >
        <StarRow rating={displayRating} size={28} />
        {userReview?.overallRating ? (
          <span className="text-sm font-medium text-foreground">
            {userReview.overallRating % 0.25 === 0 && userReview.overallRating % 0.5 !== 0
              ? userReview.overallRating.toFixed(2)
              : userReview.overallRating.toFixed(1)}
          </span>
        ) : null}
      </button>

      {/* Label */}
      <button
        type="button"
        onClick={handleOpen}
        className="text-sm text-primary hover:text-primary/80 font-medium"
      >
        {userReview
          ? "Edit your review"
          : isLoggedIn
            ? "Review this book"
            : "Log in to review"}
      </button>

      {/* Aggregate */}
      {aggregate && (
        <p className="text-xs text-muted">
          {aggregate.average.toFixed(1)} avg &middot; {aggregate.count}{" "}
          {aggregate.count === 1 ? "rating" : "ratings"}
        </p>
      )}

      {/* View all reviews link */}
      {aggregate && aggregate.count > 0 && (
        <Link
          href={`/book/${bookId}/reviews`}
          className="text-xs text-primary hover:text-primary/80 font-medium"
        >
          View all reviews &rarr;
        </Link>
      )}

      {/* Wizard modal */}
      <ReviewWizard
        bookId={bookId}
        bookPages={bookPages}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        isExisting={!!userReview}
        existingReview={userReview}
      />
    </div>
  );
}
