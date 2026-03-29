import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { getUserByUsername } from "@/lib/queries/profile";
import { getShelfBySlug, getShelfWithBooks } from "@/lib/queries/shelves";
import { NoCover } from "@/components/no-cover";
import { getCurrentUser } from "@/lib/auth";
import { isFollowingShelf, getShelfFollowerCount } from "@/lib/queries/shelves";
import { ShareShelfButton } from "./share-button";
import { FollowShelfButton } from "./follow-button";

interface Props {
  params: Promise<{ username: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const user = await getUserByUsername(username);
  if (!user) return { title: "Shelf Not Found" };

  const shelfRef = await getShelfBySlug(user.id, slug);
  if (!shelfRef || !shelfRef.isPublic) return { title: "Shelf Not Found" };

  const shelf = await getShelfWithBooks(shelfRef.id);
  if (!shelf) return { title: "Shelf Not Found" };

  const title = `${shelf.name} — ${user.displayName || username}'s Shelf | tbr*a`;
  const description = shelf.description || `A curated book shelf by ${user.displayName || username} with ${shelf.books.length} books.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
  };
}

function BookshelfGrid({
  rows,
  accentColor,
  className,
  maxWidth,
}: {
  rows: { bookId: string; slug: string | null; title: string; coverImageUrl: string | null; authors: string[] }[][];
  accentColor: string;
  className?: string;
  maxWidth: string;
}) {
  return (
    <div
      className={`rounded-xl border overflow-hidden ${className || ""}`}
      style={{
        background: `linear-gradient(to bottom, ${accentColor}06, ${accentColor}10)`,
        borderColor: `${accentColor}15`,
      }}
    >
      {rows.map((row, rowIndex) => (
        <div key={rowIndex}>
          <div className="flex justify-start gap-4 px-4 pt-4 pb-2.5">
            {row.map((book) => (
              <Link
                key={book.bookId}
                href={`/book/${book.slug || book.bookId}`}
                className="group flex-1"
                style={{ maxWidth }}
              >
                <div className="relative">
                  {book.coverImageUrl ? (
                    <Image
                      src={book.coverImageUrl}
                      alt={`Cover of ${book.title}`}
                      width={100}
                      height={150}
                      className="w-full aspect-[2/3] rounded-sm object-cover shadow-[2px_2px_8px_rgba(0,0,0,0.3)] group-hover:scale-[1.03] transition-transform duration-200"
                    />
                  ) : (
                    <NoCover title={book.title} className="w-full aspect-[2/3] rounded-sm shadow-[2px_2px_8px_rgba(0,0,0,0.3)]" size="md" />
                  )}
                  <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-r from-black/20 to-transparent rounded-l-sm" />
                </div>
                <p className="mt-2 text-[11px] text-foreground font-medium line-clamp-2 leading-tight">
                  {book.title}
                </p>
                <p className="text-[10px] text-muted truncate">
                  {book.authors.join(", ")}
                </p>
              </Link>
            ))}
          </div>
          <div
            className="h-[5px] shadow-[inset_0_2px_3px_rgba(0,0,0,0.1)]"
            style={{ background: `linear-gradient(to bottom, ${accentColor}30, ${accentColor}45)` }}
          />
          <div className="h-1.5" />
        </div>
      ))}
    </div>
  );
}

export default async function PublicShelfPage({ params }: Props) {
  const { username, slug } = await params;
  const user = await getUserByUsername(username);
  if (!user) notFound();

  const shelfRef = await getShelfBySlug(user.id, slug);
  if (!shelfRef || !shelfRef.isPublic) notFound();

  const shelf = await getShelfWithBooks(shelfRef.id);
  if (!shelf) notFound();

  const session = await getCurrentUser();
  const isOwner = session?.userId === shelf.userId;
  const [following, followerCount] = await Promise.all([
    session && !isOwner ? isFollowingShelf(session.userId, shelfRef.id) : Promise.resolve(false),
    getShelfFollowerCount(shelfRef.id),
  ]);

  const accentColor = shelf.color || "#d97706";

  // Chunk books into rows — 3 for mobile, 5 for desktop
  const mobileRows: typeof shelf.books[] = [];
  for (let i = 0; i < shelf.books.length; i += 3) {
    mobileRows.push(shelf.books.slice(i, i + 3));
  }
  const desktopRows: typeof shelf.books[] = [];
  for (let i = 0; i < shelf.books.length; i += 5) {
    desktopRows.push(shelf.books.slice(i, i + 5));
  }

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Link
          href={`/u/${username}`}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-alt transition-colors text-muted hover:text-foreground"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-foreground text-xl font-bold tracking-tight truncate">
            {shelf.name}
          </h1>
          <p className="text-xs text-muted">
            by{" "}
            <Link href={`/u/${username}`} className="text-accent hover:text-accent-dark font-medium">
              {user.displayName || `@${username}`}
            </Link>
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {session && !isOwner && (
            <FollowShelfButton
              shelfId={shelfRef.id}
              initialFollowing={following}
              followerCount={followerCount}
            />
          )}
          <ShareShelfButton />
        </div>
      </div>

      {/* Meta */}
      <div className="mb-5 flex items-center gap-2">
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: accentColor }}
        />
        <span className="text-xs text-muted">
          {shelf.books.length} {shelf.books.length === 1 ? "book" : "books"}
        </span>
      </div>
      {shelf.description && (
        <p className="text-sm text-muted mb-5">{shelf.description}</p>
      )}

      {/* Bookshelf */}
      {shelf.books.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">This shelf is empty.</p>
        </div>
      ) : (
        <>
          {/* Mobile: 3 per row */}
          <BookshelfGrid rows={mobileRows} accentColor={accentColor} className="lg:hidden" maxWidth="30%" />
          {/* Desktop: 5 per row */}
          <BookshelfGrid rows={desktopRows} accentColor={accentColor} className="hidden lg:block" maxWidth="18%" />
        </>
      )}
    </div>
  );
}
