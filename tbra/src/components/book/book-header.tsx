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
    <div className="relative overflow-hidden rounded-2xl">
      {/* Blurred cover background */}
      {coverImageUrl && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverImageUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-150 object-cover blur-3xl opacity-60"
          />
          <div className="absolute inset-0 bg-black/40" />
        </>
      )}
      {!coverImageUrl && <div className="absolute inset-0 bg-gradient-to-br from-primary-dark to-primary" />}

      {/* Foreground content */}
      <div className="relative z-10 flex flex-col items-center px-6 pb-8 pt-10">
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={`Cover of ${title}`}
            width={180}
            height={270}
            className="h-[270px] w-[180px] rounded-lg object-cover shadow-xl"
          />
        ) : (
          <div className="flex h-[270px] w-[180px] items-center justify-center rounded-lg bg-white/10 text-sm text-white/60 shadow-xl">
            No cover
          </div>
        )}

        <h1 className="mt-5 text-center text-2xl font-bold tracking-tight text-white drop-shadow-sm">
          {title}
        </h1>

        {authors.length > 0 && (
          <p className="mt-1 text-center text-white/80">
            {authors.map((a, i) => (
              <span key={a.id}>
                {i > 0 && ", "}
                <Link
                  href={`/author/${a.id}`}
                  className="underline decoration-white/40 hover:decoration-white transition-colors"
                >
                  {a.name}
                </Link>
              </span>
            ))}
          </p>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-sm text-white/70">
          {publicationYear && <span>{publicationYear}</span>}
          {pages && (
            <>
              {publicationYear && <span>&middot;</span>}
              <span>{pages} pages</span>
            </>
          )}
        </div>

        {genres.length > 0 && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {genres.map((genre) => (
              <span
                key={genre}
                className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
              >
                {genre}
              </span>
            ))}
          </div>
        )}

        <span className="mt-3 text-xs text-white/50">
          View editions
        </span>
      </div>
    </div>
  );
}
