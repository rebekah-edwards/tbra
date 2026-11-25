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
import { CoverArtHero, HERO_BACK_BUTTON_CLASS } from "@/components/ui/cover-art-hero";
import { isAuthorIndexable, NOINDEX_FOLLOW } from "@/lib/seo/indexability";

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

  const indexable = await isAuthorIndexable(resolved.author.id);

  return {
    title: `All Books by ${resolved.author.name} | tbr*a`,
    description: `Explore all books by ${resolved.author.name} on tbr*a. Browse their complete catalog with content details, reviews, and series information.`,
    alternates: { canonical: canonicalUrl },
    ...(indexable ? {} : { robots: NOINDEX_FOLLOW }),
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

  // Hero art: the author's books with real covers, most-read first is not
  // known here, so take them in the page's order (series first, then
  // standalones) and skip covers that are missing.
  const heroCovers = [
    ...[...seriesMap.values()].flatMap((s) => s.books),
    ...standaloneBooks,
  ]
    .map((b) => b.coverImageUrl)
    .filter((u): u is string => !!u)
    .slice(0, 3);

  return (
    <div>
      <CoverArtHero
        leading={<BackButton className={HERO_BACK_BUTTON_CLASS} />}
        eyebrow="Author"
        title={author.name}
        covers={heroCovers}
        stats={[
          { label: authorBooksList.length === 1 ? "book" : "books", value: authorBooksList.length, hue: "lime" },
          ...(seriesMap.size > 0
            ? [{ label: seriesMap.size === 1 ? "series" : "series", value: seriesMap.size, hue: "blue" as const }]
            : []),
          ...(followerCount > 0
            ? [{ label: followerCount === 1 ? "follower" : "followers", value: followerCount, hue: "purple" as const }]
            : []),
        ]}
        actions={
          session ? <AuthorFollowButton authorId={author.id} initialIsFollowing={following} /> : undefined
        }
      >
        {author.bio && (
          <p className="whitespace-pre-line text-sm leading-relaxed text-foreground/85">{author.bio}</p>
        )}
      </CoverArtHero>

      {/* Series sections */}
      {[...seriesMap.entries()].map(([seriesId, { name, slug, books: seriesBooks }]) => (
        <section key={seriesId} className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="section-heading text-lg">
              <Link
                href={slug ? `/series/${slug}` : `/search?series=${seriesId}`}
                className="hover:text-neon-blue transition-colors"
              >
                {name}
              </Link>
            </h2>
            <Link
              href={slug ? `/series/${slug}` : `/search?series=${seriesId}`}
              className="text-xs text-neon-blue hover:text-neon-blue/80 transition-colors whitespace-nowrap"
            >
              View Series &rarr;
            </Link>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
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
                <p className="mt-2 text-sm font-medium leading-tight group-hover:text-neon-blue">
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
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-7 xl:grid-cols-8">
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
                    <span className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 rounded-full border border-white/15 bg-black/55 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white backdrop-blur-md">
                      <span className={`h-1.5 w-1.5 rounded-full ${book.isFiction ? "bg-accent" : "bg-neon-blue"}`} />
                      {book.isFiction ? "Fiction" : "Nonfiction"}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-medium leading-tight group-hover:text-neon-blue">
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
        <div className="mt-8 rounded-[22px] border border-foreground/10 bg-surface/70 p-6 text-center backdrop-blur-md">
          <p className="text-sm text-muted">No books in library yet.</p>
        </div>
      )}
    </div>
  );
}
