import { redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getCurrentUser } from "@/lib/auth";
import { getUserReviewsWithBooks } from "@/lib/queries/user-reviews";
import { stripHtml, formatRating } from "@/lib/text-utils";
import { NoCover } from "@/components/no-cover";

export default async function AllReviewsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const reviews = await getUserReviewsWithBooks(session.userId, 10000);

  return (
    <div className="space-y-6 max-w-3xl lg:max-w-[60%] mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/profile" className="text-muted hover:text-foreground transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1
          className="text-foreground text-xl font-bold tracking-tight"
         
        >
          My Reviews
        </h1>
        <span className="text-sm text-muted">({reviews.length})</span>
      </div>

      {/* Reviews list */}
      <div className="space-y-3">
        {reviews.map((review) => {
          const previewText = review.reviewText
            ? stripHtml(review.reviewText).slice(0, 150) + (stripHtml(review.reviewText).length > 150 ? "..." : "")
            : null;

          return (
            <Link
              key={review.reviewId}
              href={`/book/${review.bookSlug || review.bookId}/reviews#review-${review.reviewId}`}
              className="flex gap-3 rounded-lg border border-border bg-surface p-3 hover:border-primary/30 transition-colors"
            >
              {review.coverImageUrl ? (
                <Image
                  src={review.coverImageUrl}
                  alt={`Cover of ${review.title}`}
                  width={40}
                  height={60}
                  className="h-[60px] w-[40px] rounded object-cover flex-shrink-0"
                />
              ) : (
                <NoCover title={review.title} className="h-[60px] w-[40px] flex-shrink-0" size="sm" />
              )}
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-semibold leading-tight line-clamp-1">{review.title}</h4>
                <p className="text-xs text-muted line-clamp-1">{review.authors.join(", ")}</p>
                <div className="flex items-center gap-2 mt-1">
                  {review.rating && (
                    <span className="text-xs text-primary font-medium">
                      {formatRating(review.rating)} ★
                    </span>
                  )}
                  <span className="text-[10px] text-muted">
                    {new Date(review.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </span>
                </div>
                {previewText && (
                  <p className="text-xs text-muted/70 mt-1 italic line-clamp-3">&ldquo;{previewText}&rdquo;</p>
                )}
              </div>
            </Link>
          );
        })}
      </div>

      {reviews.length === 0 && (
        <p className="text-center text-sm text-muted py-8">No reviews yet.</p>
      )}
    </div>
  );
}
