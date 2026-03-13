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
    <div>
      {/* Hero card with blurred background */}
      <div className="relative overflow-hidden rounded-2xl">
        {/* Blurred cover background — boosted saturation + brightness */}
        {coverImageUrl && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={coverImageUrl}
              alt=""
              aria-hidden
              className="absolute inset-0 h-full w-full scale-150 object-cover blur-2xl opacity-80 saturate-150 brightness-110"
            />
            <div className="absolute inset-0 bg-black/25" />
          </>
        )}
        {!coverImageUrl && (
          <div className="absolute inset-0 bg-gradient-to-br from-primary-dark to-primary" />
        )}

        {/* Side-by-side layout: cover left, info right */}
        <div className="relative z-10 flex gap-6 p-6">
          <div className="flex-shrink-0">
            {coverImageUrl ? (
              <Image
                src={coverImageUrl}
                alt={`Cover of ${title}`}
                width={140}
                height={210}
                className="h-[210px] w-[140px] rounded-lg object-cover shadow-xl"
              />
            ) : (
              <div className="flex h-[210px] w-[140px] items-center justify-center rounded-lg bg-white/10 text-sm text-white/60 shadow-xl">
                No cover
              </div>
            )}
          </div>

          <div className="flex flex-col justify-center">
            <h1 className="text-xl font-bold tracking-tight text-white drop-shadow-sm sm:text-2xl">
              {title}
            </h1>

            {authors.length > 0 && (
              <p className="mt-1 text-sm text-white/80">
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

            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-white/70">
              {publicationYear && <span>{publicationYear}</span>}
              {pages && (
                <>
                  {publicationYear && <span>&middot;</span>}
                  <span>{pages} pages</span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Genre tags + editions below the hero */}
      {(genres.length > 0 || true) && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {genres.map((genre) => (
            <span
              key={genre}
              className="rounded-full bg-primary-light/20 px-2.5 py-0.5 text-xs font-medium text-primary-dark"
            >
              {genre}
            </span>
          ))}
          <span className="text-xs text-muted">
            View editions
          </span>
        </div>
      )}
    </div>
  );
}
