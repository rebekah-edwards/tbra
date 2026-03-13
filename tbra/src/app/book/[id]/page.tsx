import { notFound } from "next/navigation";
import Link from "next/link";
import { getBookWithDetails } from "@/lib/queries/books";
import { BookHeader } from "@/components/book/book-header";
import { BookDescription } from "@/components/book/book-description";
import { ContentProfile } from "@/components/book/content-profile";

export default async function BookPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const book = await getBookWithDetails(id);

  if (!book) {
    notFound();
  }

  return (
    <div>
      <div className="mb-6">
        <Link
          href="/search"
          className="text-sm text-primary hover:text-primary-dark"
        >
          &larr; Back to search
        </Link>
      </div>

      <BookHeader
        title={book.title}
        coverImageUrl={book.coverImageUrl}
        authors={book.authors}
        genres={book.genres}
        publicationYear={book.publicationYear}
        pages={book.pages}
      />

      <BookDescription description={book.description} />

      <ContentProfile ratings={book.ratings} />
    </div>
  );
}
