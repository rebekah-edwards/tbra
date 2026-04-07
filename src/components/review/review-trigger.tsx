"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { StarRow } from "./rounded-star";
import { ReviewWizard } from "./review-wizard";
import { ArcSourceForm } from "@/components/book/arc-source-form";
import type { ArcSourceData } from "@/components/book/arc-source-form";
import type { UserReview } from "@/lib/queries/review";

interface ReviewTriggerProps {
  bookId: string;
  bookSlug?: string | null;
  bookPages?: number | null;
  userReview: UserReview | null;
  aggregate: { average: number; count: number } | null;
  isLoggedIn: boolean;
  autoOpen?: boolean;
  hasCompletedSession?: boolean;
  prePublication?: boolean;
}

export function ReviewTrigger({
  bookId,
  bookSlug,
  bookPages,
  userReview,
  aggregate,
  isLoggedIn,
  autoOpen = false,
  hasCompletedSession = false,
  prePublication = false,
}: ReviewTriggerProps) {
  const bookPath = bookSlug ? `/book/${bookSlug}` : `/book/${bookId}`;
  const [wizardOpen, setWizardOpen] = useState(autoOpen);
  const [arcFormOpen, setArcFormOpen] = useState(false);
  const [arcData, setArcData] = useState<ArcSourceData | null>(null);
  const router = useRouter();

  // React to autoOpen changing from false→true after mount
  useEffect(() => {
    if (autoOpen) {
      if (prePublication && !arcData) {
        setArcFormOpen(true);
      } else {
        setWizardOpen(true);
      }
    }
  }, [autoOpen, prePublication, arcData]);

  const handleOpen = () => {
    if (!isLoggedIn) {
      router.push("/login");
      return;
    }
    if (prePublication && !arcData && !userReview) {
      setArcFormOpen(true);
    } else {
      setWizardOpen(true);
    }
  };

  const handleArcSubmit = (data: ArcSourceData) => {
    setArcData(data);
    setArcFormOpen(false);
    setWizardOpen(true);
  };

  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      {/* Aggregate rating display — all clickable */}
      {aggregate && (
        <Link
          href={`${bookPath}/reviews`}
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
          className="text-sm text-neon-blue hover:text-neon-blue/80 font-medium"
        >
          Edit your review
        </button>
      ) : isLoggedIn && hasCompletedSession ? (
        <button
          type="button"
          onClick={handleOpen}
          className="text-sm text-neon-blue hover:text-neon-blue/80 font-medium"
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
          className="text-sm text-neon-blue hover:text-neon-blue/80 font-medium"
        >
          Log in to review
        </button>
      )}

      {/* ARC source form for pre-pub books */}
      {prePublication && (
        <ArcSourceForm
          open={arcFormOpen}
          onClose={() => setArcFormOpen(false)}
          onSubmit={handleArcSubmit}
        />
      )}

      {/* Wizard modal */}
      <ReviewWizard
        bookId={bookId}
        bookPages={bookPages}
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        isExisting={!!userReview}
        existingReview={userReview}
        arcData={arcData}
      />
    </div>
  );
}
