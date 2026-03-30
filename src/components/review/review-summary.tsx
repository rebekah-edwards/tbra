import Link from "next/link";
import Image from "next/image";
import { StarRow } from "./rounded-star";
import type { ReviewSummaryData } from "@/lib/queries/review-summary";

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ReviewSummary({
  data,
  bookId,
  bookSlug,
}: {
  data: ReviewSummaryData;
  bookId: string;
  bookSlug?: string | null;
}) {
  return (
    <section className="mt-8 space-y-4">
      <h2 className="section-heading text-xl">
        What Readers Think
      </h2>

      {/* Top reviews (compact, clickable) */}
      {data.topReviews.length > 0 && (
        <div className="space-y-2.5">
          {data.topReviews.map((review) => (
            <Link
              key={review.id}
              href={`/book/${bookSlug || bookId}/reviews#review-${review.id}`}
              className="block rounded-lg bg-surface-alt border border-border/50 p-3 space-y-1.5 hover:border-border transition-colors"
            >
              {/* Header: avatar + name + stars */}
              <div className="flex items-center gap-2.5">
                <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold overflow-hidden ${
                  review.isAnonymous
                    ? "bg-muted/20 text-muted"
                    : review.avatarUrl
                      ? ""
                      : "text-black"
                }`} style={!review.isAnonymous && !review.avatarUrl ? { backgroundColor: "#a3e635" } : undefined}>
                  {review.isAnonymous ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                      <circle cx="12" cy="7" r="4" />
                    </svg>
                  ) : review.avatarUrl ? (
                    <Image src={review.avatarUrl} alt="" width={28} height={28} className="w-full h-full object-cover" loading="lazy" />
                  ) : (
                    getInitials(review.displayName)
                  )}
                </div>
                <span className={`text-sm font-medium truncate flex-1 ${
                  review.isAnonymous ? "text-muted italic" : "text-foreground"
                }`}>
                  {review.isAnonymous ? "Anonymous" : (review.displayName || "tbr*a reader")}
                </span>
                {review.overallRating != null && (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <StarRow rating={review.overallRating} size={14} />
                    <span className="text-xs font-semibold text-foreground">
                      {review.overallRating % 0.5 !== 0
                        ? review.overallRating.toFixed(2)
                        : review.overallRating.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
              {/* Truncated plain text */}
              <p className="text-xs text-foreground/70 leading-relaxed line-clamp-2">
                {review.reviewTextPlain}
              </p>
            </Link>
          ))}
        </div>
      )}

      {/* View all reviews link */}
      <Link
        href={`/book/${bookSlug || bookId}/reviews`}
        className="flex items-center justify-center gap-1 text-sm font-medium read-more-link transition-colors py-1"
      >
        View {data.totalReviewCount > 1 ? `all ${data.totalReviewCount} ` : ""}
        {data.totalReviewCount === 1 ? "1 review" : "reviews"}
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </Link>
    </section>
  );
}
