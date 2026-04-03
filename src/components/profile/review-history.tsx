import Link from "next/link";
import Image from "next/image";
import { formatRating } from "@/lib/text-utils";
import type { UserReviewWithBook } from "@/lib/queries/user-reviews";
import { NoCover } from "@/components/no-cover";

interface ReviewHistoryProps {
  reviews: UserReviewWithBook[];
}

export function ReviewHistory({ reviews }: ReviewHistoryProps) {
  if (reviews.length === 0) {
    return (
      <section>
        <h2
          className="section-heading text-sm mb-3"
        >
          Recent Reviews
        </h2>
        <p className="text-sm text-muted">No reviews yet.</p>
      </section>
    );
  }

  return (
    <section>
      <h2
        className="section-heading text-sm mb-3"
      >
        Recent Reviews
      </h2>
      <div className="grid grid-cols-3 gap-3 lg:grid-cols-6">
        {reviews.slice(0, 6).map((review) => (
          <Link
            key={review.reviewId}
            href={`/book/${review.bookSlug || review.bookId}/reviews#review-${review.reviewId}`}
            className="group relative overflow-hidden rounded-lg"
          >
            {/* Cover image */}
            <div className="relative aspect-[2/3] w-full">
              {review.coverImageUrl ? (
                <Image
                  src={review.coverImageUrl}
                  alt={`Cover of ${review.title}`}
                  fill
                  className="rounded-lg object-cover"
                  sizes="(max-width: 768px) 30vw, 200px"
                />
              ) : (
                <NoCover title={review.title} className="h-full w-full" size="sm" />
              )}

              {/* Star rating badge — bottom right (larger, yellow star) */}
              {review.rating && (
                <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white backdrop-blur-sm flex items-center gap-0.5">
                  {formatRating(review.rating)} <span className="text-yellow-400">★</span>
                </span>
              )}

              {/* Written review indicator — bottom left */}
              {review.reviewText && (
                <span className="absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 backdrop-blur-sm" title="Has written review">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </span>
              )}
            </div>
          </Link>
        ))}
      </div>

      {/* View all reviews link */}
      <div className="mt-3 text-center">
        <Link
          href="/profile/reviews"
          className="text-xs text-neon-blue hover:text-neon-blue/80 font-medium"
        >
          View all reviews →
        </Link>
      </div>
    </section>
  );
}
