import Link from "next/link";

interface BookHeaderProps {
  title: string;
  coverImageUrl: string | null;
  authors: { id: string; name: string; role: string }[];
  genres: string[];
  publicationYear: number | null;
  pages: number | null;
  audioLengthMinutes?: number | null;
  showAudioLength?: boolean;
  isManuallyAdded?: boolean;
  isFiction?: boolean | null;
}

export function BookHeader({
  title,
  coverImageUrl,
  authors,
  genres,
  publicationYear,
  pages,
  audioLengthMinutes,
  showAudioLength,
  isManuallyAdded,
  isFiction,
}: BookHeaderProps) {
  const formatMeta = showAudioLength
    ? (audioLengthMinutes
        ? `${Math.floor(audioLengthMinutes / 60)}h ${audioLengthMinutes % 60}m`
        : "Audiobook")
    : pages
      ? `${pages} pages`
      : null;
  const fictionLabel = isFiction === true ? "Fiction" : isFiction === false ? "Nonfiction" : null;

  return (
    <div className="relative overflow-visible">
      {/* Full-bleed color spill — escapes container to viewport edges */}
      {coverImageUrl && (
        <div className="hero-bleed absolute -top-20 bottom-0 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={coverImageUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-150 object-cover blur-3xl opacity-60 saturate-150 brightness-110"
          />
          {/* Fade to background at bottom */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
          {/* Fade to background at sides */}
          <div className="absolute inset-0 bg-gradient-to-r from-background/50 via-transparent to-background/50" />
        </div>
      )}

      {/* Card with darker background */}
      <div className="relative rounded-2xl overflow-visible">
        {fictionLabel && (
          <span className="absolute -top-3 right-4 z-20 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-background shadow-md">
            {fictionLabel}
          </span>
        )}
        {/* Inner background — clipped */}
        <div className="absolute inset-0 overflow-hidden rounded-2xl">
          {coverImageUrl && (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={coverImageUrl}
                alt=""
                aria-hidden
                className="absolute inset-0 h-full w-full scale-150 object-cover blur-2xl opacity-80 saturate-150 brightness-110"
              />
              <div className="absolute inset-0 bg-black/30" />
            </>
          )}
          {!coverImageUrl && (
            <div className="absolute inset-0 bg-gradient-to-br from-primary-dark to-primary" />
          )}
        </div>

        {/* Side-by-side layout: cover left, info right */}
        <div className="relative z-10 flex gap-6 p-6">
          <div className="flex-shrink-0 flex items-center">
            {coverImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={coverImageUrl}
                alt={`Cover of ${title}`}
                className="w-[140px] h-auto rounded-lg object-contain shadow-xl"
              />
            ) : (
              <div className="flex items-center justify-center rounded-lg bg-white/10 text-sm text-white/60 shadow-xl w-[140px] h-[210px]">
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
              {formatMeta && (
                <>
                  {publicationYear && <span>&middot;</span>}
                  <span className="inline-flex items-center gap-1">
                    {showAudioLength && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                      </svg>
                    )}
                    {formatMeta}
                  </span>
                </>
              )}
            </div>

            {(genres.length > 0 || isManuallyAdded) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {genres.map((genre) => (
                  <span
                    key={genre}
                    className="rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white backdrop-blur-sm"
                  >
                    {genre}
                  </span>
                ))}
                {isManuallyAdded && (
                  <span className="rounded-full bg-amber-500/80 px-2.5 py-0.5 text-xs font-semibold text-white backdrop-blur-sm">
                    Manually Added
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
