"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StarRow } from "./rounded-star";
import { ReviewWizard } from "./review-wizard";
import { deleteReview } from "@/lib/actions/review";
import type { UserReview } from "@/lib/queries/review";

interface ReviewTriggerProps {
  bookId: string;
  userReview: UserReview | null;
  aggregate: { average: number; count: number } | null;
  isLoggedIn: boolean;
  autoOpen?: boolean;
}

export function ReviewTrigger({
  bookId,
  userReview,
  aggregate,
  isLoggedIn,
  autoOpen = false,
}: ReviewTriggerProps) {
  const [wizardOpen, setWizardOpen] = useState(autoOpen);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, startDeleteTransition] = useTransition();
  const router = useRouter();

  const handleOpen = () => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    setWizardOpen(true);
  };

  const handleDelete = () => {
    startDeleteTransition(async () => {
      await deleteReview(bookId);
      setShowDeleteConfirm(false);
    });
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

      {/* Delete option — only shown for existing reviews */}
      {userReview && !showDeleteConfirm && (
        <button
          type="button"
          onClick={() => setShowDeleteConfirm(true)}
          className="text-xs text-muted hover:text-destructive transition-colors mt-1"
        >
          Delete review
        </button>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="flex items-center gap-2 mt-1">
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting}
            className="text-xs text-destructive font-medium hover:text-destructive/80 transition-colors"
          >
            {isDeleting ? "Deleting..." : "Confirm delete"}
          </button>
          <span className="text-xs text-muted">·</span>
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(false)}
            className="text-xs text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Aggregate */}
      {aggregate && (
        <p className="text-xs text-muted">
          {aggregate.average.toFixed(1)} avg &middot; {aggregate.count}{" "}
          {aggregate.count === 1 ? "rating" : "ratings"}
        </p>
      )}

      {/* Wizard modal */}
      <ReviewWizard
        bookId={bookId}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        existingReview={userReview}
      />
    </div>
  );
}
