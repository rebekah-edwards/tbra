import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getAuthorWithBooks } from "@/lib/queries/authors";

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const author = await getAuthorWithBooks(id);

  if (!author) {
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

      <h1 className="text-2xl font-bold tracking-tight">{author.name}</h1>
      {author.bio && (
        <p className="mt-2 text-sm leading-relaxed text-muted">{author.bio}</p>
      )}

      {author.books.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            Books ({author.books.length})
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {author.books.map((book) => (
              <Link
                key={book.id}
                href={`/book/${book.id}`}
                className="group"
              >
                <div className="overflow-hidden rounded-lg">
                  {book.coverImageUrl ? (
                    <Image
                      src={book.coverImageUrl}
                      alt={`Cover of ${book.title}`}
                      width={160}
                      height={240}
                      className="aspect-[2/3] h-auto w-full rounded-lg object-cover shadow-sm transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex aspect-[2/3] h-auto w-full items-center justify-center rounded-lg bg-surface-alt text-sm text-muted shadow-sm">
                      No cover
                    </div>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium leading-tight group-hover:text-primary">
                  {book.title}
                </p>
                {book.publicationYear && (
                  <p className="text-xs text-muted">{book.publicationYear}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {author.books.length === 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">No books in library yet.</p>
        </div>
      )}
    </div>
  );
}
