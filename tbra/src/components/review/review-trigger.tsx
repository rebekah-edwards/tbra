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
  hasCompletedSession?: boolean;
}

export function ReviewTrigger({
  bookId,
  bookPages,
  userReview,
  aggregate,
  isLoggedIn,
  autoOpen = false,
  hasCompletedSession = false,
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

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      {/* Aggregate rating display — all clickable */}
      {aggregate && (
        <Link
          href={`/book/${bookId}/reviews`}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        >
          <StarRow rating={aggregate.average} size={22} />
          <span className="text-sm font-semibold text-foreground/70">
            {aggregate.average.toFixed(1)} avg.
          </span>
          <span className="text-sm text-foreground/50">&middot;</span>
          <span className="text-sm text-foreground/70 underline underline-offset-2">
            {aggregate.count} {aggregate.count === 1 ? "review" : "reviews"}
          </span>
        </Link>
      )}

      {/* Review CTA */}
      {userReview ? (
        <button
          type="button"
          onClick={handleOpen}
          className="text-sm text-primary hover:text-primary/80 font-medium"
        >
          Edit your review
        </button>
      ) : isLoggedIn && hasCompletedSession ? (
        <button
          type="button"
          onClick={handleOpen}
          className="text-sm text-primary hover:text-primary/80 font-medium"
        >
          Review this book
        </button>
      ) : isLoggedIn ? (
        <span className="text-sm text-muted">
          Mark as finished to review
        </span>
      ) : (
        <button
          type="button"
          onClick={handleOpen}
          className="text-sm text-primary hover:text-primary/80 font-medium"
        >
          Log in to review
        </button>
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
