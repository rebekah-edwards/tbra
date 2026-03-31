"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";

const ARC_SOURCE_LABELS: Record<string, string> = {
  netgalley: "NetGalley",
  publisher_arc: "Publisher ARC",
  author_copy: "Author Copy",
  booksirens: "BookSirens",
  edelweiss: "Edelweiss+",
  other: "Other",
};

const STATUSES = ["pending", "approved", "rejected"] as const;

interface ArcReview {
  id: string;
  userId: string;
  bookId: string;
  overallRating: number | null;
  reviewText: string | null;
  arcSource: string | null;
  arcSourceDetail: string | null;
  arcProofUrl: string | null;
  arcStatus: string | null;
  createdAt: string;
  bookTitle: string;
  bookSlug: string | null;
  userDisplayName: string | null;
  userUsername: string | null;
  userEmail: string;
}

interface ArcReviewQueueProps {
  reviews: ArcReview[];
  statusCounts: Record<string, number>;
  activeStatus: string;
}

export function ArcReviewQueue({ reviews, statusCounts, activeStatus }: ArcReviewQueueProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleAction(reviewId: string, action: "approve" | "reject") {
    startTransition(async () => {
      await fetch(`/api/admin/arc-reviews/${reviewId}/${action}`, { method: "POST" });
      window.location.reload();
    });
  }

  return (
    <div>
      {/* Status tabs */}
      <div className="flex gap-2 mb-6">
        {STATUSES.map((status) => (
          <Link
            key={status}
            href={`/admin/arc-reviews?status=${status}`}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              activeStatus === status
                ? "bg-accent text-black"
                : "bg-surface-alt text-muted hover:text-foreground"
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
            {statusCounts[status] ? ` (${statusCounts[status]})` : ""}
          </Link>
        ))}
      </div>

      {/* Review list */}
      {reviews.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted">No {activeStatus} ARC reviews.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="rounded-xl border border-border bg-surface p-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <Link
                    href={`/book/${review.bookSlug || review.bookId}`}
                    className="text-sm font-semibold text-foreground hover:text-link"
                  >
                    {review.bookTitle}
                  </Link>
                  <p className="text-xs text-muted mt-0.5">
                    by {review.userDisplayName || review.userUsername || review.userEmail}
                    {review.overallRating && ` · ${review.overallRating} ★`}
                  </p>
                  <p className="text-xs text-muted/60 mt-0.5">
                    Source: {ARC_SOURCE_LABELS[review.arcSource ?? ""] ?? review.arcSource}
                    {review.arcSourceDetail && ` — ${review.arcSourceDetail}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === review.id ? null : review.id)}
                  className="text-xs text-link shrink-0"
                >
                  {expandedId === review.id ? "Collapse" : "Details"}
                </button>
              </div>

              {expandedId === review.id && (
                <div className="mt-3 pt-3 border-t border-border space-y-3">
                  {review.reviewText && (
                    <div>
                      <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">Review</p>
                      <p className="text-sm text-foreground whitespace-pre-wrap">{review.reviewText}</p>
                    </div>
                  )}
                  {review.arcProofUrl && (
                    <div>
                      <p className="text-xs font-medium text-muted uppercase tracking-wide mb-1">Proof</p>
                      <Image
                        src={review.arcProofUrl}
                        alt="ARC proof"
                        width={300}
                        height={200}
                        className="rounded-lg border border-border object-contain max-h-64"
                      />
                    </div>
                  )}
                  {activeStatus === "pending" && (
                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => handleAction(review.id, "approve")}
                        disabled={isPending}
                        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:brightness-110 transition-all disabled:opacity-50"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => handleAction(review.id, "reject")}
                        disabled={isPending}
                        className="rounded-lg bg-red-500/20 text-red-400 px-4 py-2 text-sm font-semibold hover:bg-red-500/30 transition-colors disabled:opacity-50"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
