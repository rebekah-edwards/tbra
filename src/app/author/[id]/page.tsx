import type { Metadata } from "next";
export const revalidate = 120;
import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { resolveAuthor, getAuthorBooks } from "@/lib/queries/authors";
import { isFollowingAuthor, getAuthorFollowerCount } from "@/lib/queries/author-follows";
import { getCurrentUser } from "@/lib/auth";
import { NoCover } from "@/components/no-cover";
import { BackButton } from "@/components/ui/back-button";
import { AuthorFollowButton } from "@/components/author/author-follow-button";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const resolved = await resolveAuthor(id);
  if (!resolved) return { title: "Author Not Found | tbr*a" };

  const slug = resolved.author.slug;
  const canonicalUrl = slug
    ? `https://thebasedreader.app/author/${slug}`
    : `https://thebasedreader.app/author/${resolved.author.id}`;

  return {
    title: `All Books by ${resolved.author.name} | tbr*a`,
    description: `Explore all books by ${resolved.author.name} on tbr*a. Browse their complete catalog with content details, reviews, and series information.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `All Books by ${resolved.author.name} | tbr*a`,
      description: `Explore all books by ${resolved.author.name} on tbr*a. Browse their complete catalog with content details, reviews, and series information.`,
      url: canonicalUrl,
    },
  };
}

export default async function AuthorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const resolved = await resolveAuthor(id);

  if (!resolved) {
    notFound();
  }

  // If accessed by UUID and author has a slug, redirect to canonical slug URL
  if (resolved.isIdLookup && resolved.author.slug) {
    redirect(`/author/${resolved.author.slug}`);
  }

  const author = resolved.author;
  const [authorBooksList, session] = await Promise.all([
    getAuthorBooks(author.id),
    getCurrentUser(),
  ]);

  const [following, followerCount] = session
    ? await Promise.all([
        isFollowingAuthor(session.userId, author.id),
        getAuthorFollowerCount(author.id),
      ])
    : [false, await getAuthorFollowerCount(author.id)];

  // Group books by series for display
  const seriesMap = new Map<string, { name: string; slug: string | null; books: typeof authorBooksList }>();
  const standaloneBooks: typeof authorBooksList = [];

  for (const book of authorBooksList) {
    if (book.seriesInfo) {
      const key = book.seriesInfo.id;
      if (!seriesMap.has(key)) {
        seriesMap.set(key, { name: book.seriesInfo.name, slug: book.seriesInfo.slug, books: [] });
      }
      seriesMap.get(key)!.books.push(book);
    } else {
      standaloneBooks.push(book);
    }
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-2">
        <BackButton />
        <h1 className="text-foreground text-2xl font-bold tracking-tight">{author.name}</h1>
        {session && (
          <AuthorFollowButton authorId={author.id} initialIsFollowing={following} />
        )}
      </div>
      {followerCount > 0 && (
        <p className="text-xs text-muted mt-1 ml-10">
          {followerCount} {followerCount === 1 ? "follower" : "followers"}
        </p>
      )}
      {author.bio && (
        <p className="mt-2 text-sm leading-relaxed text-muted">{author.bio}</p>
      )}

      {/* Series sections */}
      {[...seriesMap.entries()].map(([seriesId, { name, slug, books: seriesBooks }]) => (
        <section key={seriesId} className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="section-heading text-lg">
              <Link
                href={slug ? `/series/${slug}` : `/search?series=${seriesId}`}
                className="hover:text-link transition-colors"
              >
                {name}
              </Link>
            </h2>
            <Link
              href={slug ? `/series/${slug}` : `/search?series=${seriesId}`}
              className="text-xs text-link hover:text-link/80 transition-colors whitespace-nowrap"
            >
              View Series &rarr;
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {seriesBooks.map((book) => (
              <Link
                key={book.id}
                href={book.slug ? `/book/${book.slug}` : `/book/${book.id}`}
                className="group"
              >
                <div className="relative overflow-hidden rounded-lg">
                  {book.coverImageUrl ? (
                    <Image
                      src={book.coverImageUrl}
                      alt={`Cover of ${book.title}`}
                      width={160}
                      height={240}
                      className="aspect-[2/3] h-auto w-full rounded-lg object-cover shadow-sm transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <NoCover title={book.title} className="aspect-[2/3] w-full shadow-sm" size="md" />
                  )}
                </div>
                <p className="mt-2 text-sm font-medium leading-tight group-hover:text-link">
                  {book.title}
                </p>
                {book.publicationYear && (
                  <p className="text-xs text-muted">{book.publicationYear}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}

      {/* Standalone books */}
      {standaloneBooks.length > 0 && (
        <section className="mt-8">
          {seriesMap.size > 0 && (
            <h2 className="section-heading text-lg">
              Standalone
            </h2>
          )}
          {seriesMap.size === 0 && (
            <h2 className="section-heading text-lg">
              Books ({standaloneBooks.length})
            </h2>
          )}
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
            {standaloneBooks.map((book) => (
              <Link
                key={book.id}
                href={book.slug ? `/book/${book.slug}` : `/book/${book.id}`}
                className="group"
              >
                <div className="relative overflow-hidden rounded-lg">
                  {book.coverImageUrl ? (
                    <Image
                      src={book.coverImageUrl}
                      alt={`Cover of ${book.title}`}
                      width={160}
                      height={240}
                      className="aspect-[2/3] h-auto w-full rounded-lg object-cover shadow-sm transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <NoCover title={book.title} className="aspect-[2/3] w-full shadow-sm" size="md" />
                  )}
                  {book.isFiction != null && (
                    <span className={`absolute top-1.5 left-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide backdrop-blur-sm ${
                      book.isFiction
                        ? "bg-accent/80 text-black"
                        : "bg-neon-blue/80 text-white"
                    }`}>
                      {book.isFiction ? "Fiction" : "Nonfiction"}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium leading-tight group-hover:text-link">
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

      {authorBooksList.length === 0 && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">No books in library yet.</p>
        </div>
      )}
    </div>
  );
}
