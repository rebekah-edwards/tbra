import { notFound } from "next/navigation";
import Link from "next/link";
import { getBookWithDetails } from "@/lib/queries/books";
import { getBookReviews } from "@/lib/queries/review";
import { getCurrentUser } from "@/lib/auth";
import { ReviewListClient } from "./review-list-client";

export default async function ReviewsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  const book = await getBookWithDetails(id, user?.userId);

  if (!book) {
    notFound();
  }

  const reviews = await getBookReviews(id, user?.userId);

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border/50">
        <Link
          href={`/book/${id}`}
          className="p-1 -m-1 text-foreground/60 hover:text-foreground transition-colors"
          aria-label="Back to book"
        >
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-bold text-foreground truncate">
            Reviews
          </h1>
          <p className="text-xs text-muted truncate">{book.title}</p>
        </div>
        <span className="text-sm text-muted flex-shrink-0">
          {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
        </span>
      </div>

      {/* Review list */}
      <div className="px-4 py-4">
        <ReviewListClient reviews={reviews} bookId={id} />
      </div>
    </div>
  );
}
