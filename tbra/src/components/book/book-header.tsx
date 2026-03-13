import Image from "next/image";
import Link from "next/link";

interface BookHeaderProps {
  title: string;
  coverImageUrl: string | null;
  authors: { id: string; name: string; role: string }[];
  genres: string[];
  publicationYear: number | null;
  pages: number | null;
}

export function BookHeader({
  title,
  coverImageUrl,
  authors,
  genres,
  publicationYear,
  pages,
}: BookHeaderProps) {
  return (
    <div className="flex gap-6">
      {coverImageUrl ? (
        <Image
          src={coverImageUrl}
          alt={`Cover of ${title}`}
          width={160}
          height={240}
          className="h-[240px] w-[160px] rounded-lg object-cover shadow-sm"
        />
      ) : (
        <div className="flex h-[240px] w-[160px] items-center justify-center rounded-lg bg-surface-alt text-sm text-muted shadow-sm">
          No cover
        </div>
      )}
      <div className="flex flex-col justify-center">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {authors.length > 0 && (
          <p className="mt-1 text-muted">
            {authors.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ", "}
                <Link
                  href={`/author/${a.id}`}
                  className="hover:text-primary transition-colors"
                >
                  {a.name}
                </Link>
              </span>
            ))}
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
          {publicationYear && <span>{publicationYear}</span>}
          {pages && (
            <>
              {publicationYear && <span>&middot;</span>}
              <span>{pages} pages</span>
            </>
          )}
        </div>
        {genres.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {genres.map((genre) => (
              <span
                key={genre}
                className="rounded-full bg-primary-light/20 px-2.5 py-0.5 text-xs font-medium text-primary-dark"
              >
                {genre}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
