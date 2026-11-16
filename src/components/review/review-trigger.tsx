"use client";

import { useState, useEffect, useRef } from "react";
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
  /** Passed through to the review wizard so step 3 picks the right dimension set. */
  isFiction?: boolean | null;
  userReview: UserReview | null;
  aggregate: { average: number; count: number } | null;
  isLoggedIn: boolean;
  autoOpen?: boolean;
  /**
   * Called when the wizard (or the ARC form in front of it) is dismissed.
   * A parent that drives `autoOpen` from state should reset it here —
   * otherwise the flag stays latched at true and the parent can never
   * re-open the wizard by setting it true again.
   */
  onDismiss?: () => void;
  hasCompletedSession?: boolean;
  prePublication?: boolean;
  /** When auto-opening the wizard, pre-seed DNF mode (book was just marked DNF) */
  autoOpenAsDnf?: boolean;
  /** Pre-fill "how far did you get?" percent when auto-opening as DNF */
  autoOpenDnfPercent?: number | null;
}

export function ReviewTrigger({
  bookId,
  bookSlug,
  bookPages,
  isFiction = null,
  userReview,
  aggregate,
  isLoggedIn,
  autoOpen = false,
  onDismiss,
  hasCompletedSession = false,
  prePublication = false,
  autoOpenAsDnf = false,
  autoOpenDnfPercent = null,
}: ReviewTriggerProps) {
  const bookPath = bookSlug ? `/book/${bookSlug}` : `/book/${bookId}`;
  const [wizardOpen, setWizardOpen] = useState(autoOpen);
  const [arcFormOpen, setArcFormOpen] = useState(false);
  const [arcData, setArcData] = useState<ArcSourceData | null>(null);
  const router = useRouter();

  // Read through a ref so the effect below doesn't re-fire (and re-open the
  // wizard) when the review prop changes after a save.
  const hasReviewRef = useRef(!!userReview);
  useEffect(() => {
    hasReviewRef.current = !!userReview;
  }, [userReview]);

  // React to autoOpen changing from false→true after mount
  useEffect(() => {
    if (autoOpen) {
      // Same gate as handleOpen: editing an existing review never needs the
      // ARC-source form again.
      if (prePublication && !arcData && !hasReviewRef.current) {
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
          onClose={() => {
            setArcFormOpen(false);
            onDismiss?.();
          }}
          onSubmit={handleArcSubmit}
        />
      )}

      {/* Wizard modal */}
      <ReviewWizard
        bookId={bookId}
        bookPages={bookPages}
        isFiction={isFiction}
        open={wizardOpen}
        onClose={() => {
          setWizardOpen(false);
          onDismiss?.();
        }}
        isExisting={!!userReview}
        existingReview={userReview}
        arcData={arcData}
        initialDnf={autoOpenAsDnf && !userReview}
        initialDnfPercent={autoOpenAsDnf ? autoOpenDnfPercent : null}
      />
    </div>
  );
}
