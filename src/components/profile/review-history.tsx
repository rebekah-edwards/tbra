import Link from "next/link";
import Image from "next/image";
import { formatRating } from "@/lib/text-utils";
import type { UserReviewWithBook } from "@/lib/queries/user-reviews";
import { NoCover } from "@/components/no-cover";

interface ReviewHistoryProps {
  reviews: UserReviewWithBook[];
  /** Owner's avatar — rides inside the rating/DNF pill on each cover. */
  avatarUrl?: string | null;
}

/** Avatar bubble inside the pill — mirrors the Top Shelf treatment,
    including the accent-star fallback when no photo is set. */
function ReviewerAvatar({ avatarUrl }: { avatarUrl?: string | null }) {
  return avatarUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={avatarUrl} alt="" className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
  ) : (
    <span className="w-4 h-4 rounded-full bg-accent/60 flex items-center justify-center text-[8px] text-black font-bold flex-shrink-0">★</span>
  );
}

export function ReviewHistory({ reviews, avatarUrl }: ReviewHistoryProps) {
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

              {/* Bottom-right badges: rating and/or red DNF tag, with the
                  owner's avatar attached INSIDE the pill — same treatment as
                  the Top Shelf covers (favorites-shelf.tsx BookCover) */}
              <span className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
                {review.rating && (
                  <span className="rounded-full bg-black/75 pl-1 pr-2 py-0.5 text-xs font-semibold text-white backdrop-blur-sm flex items-center gap-1">
                    <ReviewerAvatar avatarUrl={avatarUrl} />
                    {formatRating(review.rating)} <span className="text-yellow-400">★</span>
                  </span>
                )}
                {review.didNotFinish && (
                  <span className={`rounded-full bg-destructive/90 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm flex items-center gap-1 ${review.rating ? "px-2" : "pl-1 pr-2"}`}>
                    {!review.rating && <ReviewerAvatar avatarUrl={avatarUrl} />}
                    DNF
                  </span>
                )}
              </span>
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
