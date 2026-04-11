import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { resolveBook, getBookWithDetails } from "@/lib/queries/books";
import { getBookReviews } from "@/lib/queries/review";
import { getCurrentUser } from "@/lib/auth";
import { ReviewListClient } from "./review-list-client";
import { BackButton } from "@/components/ui/back-button";

export default async function ReviewsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();

  const resolved = await resolveBook(id);
  if (!resolved) notFound();

  // If accessed by UUID and book has a slug, redirect to slug URL
  if (resolved.isIdLookup && resolved.book.slug) {
    redirect(`/book/${resolved.book.slug}/reviews`);
  }

  const book = await getBookWithDetails(resolved.book.id, user?.userId);
  if (!book) notFound();

  const reviews = await getBookReviews(resolved.book.id, user?.userId);

  const bookPath = resolved.book.slug ? `/book/${resolved.book.slug}` : `/book/${id}`;

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="px-4 py-4 border-b border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <BackButton />
          <Link
            href={bookPath}
            className="text-xs text-neon-blue hover:text-neon-blue/80 transition-colors"
          >
            View Book Details
          </Link>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <h1 className="text-foreground text-lg font-bold truncate">
              Reviews
            </h1>
            <p className="text-xs text-muted truncate">{book.title}</p>
          </div>
          <span className="text-sm text-muted flex-shrink-0">
            {reviews.length} {reviews.length === 1 ? "review" : "reviews"}
          </span>
        </div>
      </div>

      {/* Review list */}
      <div className="px-4 py-4">
        <ReviewListClient reviews={reviews} bookId={resolved.book.id} bookSlug={resolved.book.slug} currentUserId={user?.userId ?? null} />
      </div>
    </div>
  );
}
