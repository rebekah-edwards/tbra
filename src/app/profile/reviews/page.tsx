import { redirect } from "next/navigation";
import { parseDbDate } from "@/lib/date-utils";
import Link from "next/link";
import Image from "next/image";
import { getCurrentUser } from "@/lib/auth";
import { getUserReviewsWithBooks } from "@/lib/queries/user-reviews";
import { stripHtml, formatRating } from "@/lib/text-utils";
import { NoCover } from "@/components/no-cover";
import { HERO_BACK_BUTTON_CLASS } from "@/components/ui/cover-art-hero";

export default async function AllReviewsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const reviews = await getUserReviewsWithBooks(session.userId, 10000);

  const rated = reviews.filter((r) => r.rating != null);
  const avg = rated.length ? rated.reduce((n, r) => n + (r.rating ?? 0), 0) / rated.length : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5 pb-24 lg:max-w-[60%]">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/profile" aria-label="Back to profile" className={HERO_BACK_BUTTON_CLASS}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Your words</p>
          <h1 className="font-heading text-[22px] font-bold leading-tight tracking-tight text-foreground">My Reviews</h1>
        </div>
      </div>

      {reviews.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <span className="chip-glass">
            <span className="dot bg-accent" />
            {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
          </span>
          {avg != null && (
            <span className="chip-glass">
              <span className="dot bg-[#fbbf24]" />
              {formatRating(avg)} average
            </span>
          )}
        </div>
      )}

      {/* Reviews list */}
      <div className="space-y-2.5">
        {reviews.map((review) => {
          const plain = review.reviewText ? stripHtml(review.reviewText) : "";
          const previewText = plain ? plain.slice(0, 150) + (plain.length > 150 ? "..." : "") : null;

          return (
            <Link
              key={review.reviewId}
              href={`/book/${review.bookSlug || review.bookId}/reviews#review-${review.reviewId}`}
              className="row-glass group flex gap-3.5 p-3.5"
            >
              <div className="h-[72px] w-[48px] flex-shrink-0 -rotate-2 transition-transform duration-200 group-hover:rotate-0">
                {review.coverImageUrl ? (
                  <Image
                    src={review.coverImageUrl}
                    alt={`Cover of ${review.title}`}
                    width={48}
                    height={72}
                    className="h-full w-full rounded-md object-cover shadow-[0_6px_14px_rgba(0,0,0,0.4)] ring-1 ring-white/10"
                  />
                ) : (
                  <NoCover title={review.title} className="h-full w-full" size="sm" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-[15px] font-bold leading-tight text-foreground line-clamp-1">{review.title}</h2>
                <p className="text-xs text-muted line-clamp-1">{review.authors.join(", ")}</p>
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  {review.rating != null && (
                    <span className="chip-glass">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round" className="text-[#fbbf24]" aria-hidden="true">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      {formatRating(review.rating)}
                    </span>
                  )}
                  <span className="text-[11px] text-muted">
                    {parseDbDate(review.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {previewText && (
                  <p className="mt-1.5 text-xs italic text-muted line-clamp-3">&ldquo;{previewText}&rdquo;</p>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {reviews.length === 0 && (
        <div className="card-glass flex flex-col items-center px-6 py-10 text-center">
          <span className="orb-glass mb-3 h-14 w-14">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-[#c084fc]" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </span>
          <p className="font-heading text-base font-semibold text-foreground">No reviews yet</p>
          <p className="mt-1 text-sm text-muted">When you finish a book, add a few words about it from its page.</p>
        </div>
      )}
    </div>
  );
}
