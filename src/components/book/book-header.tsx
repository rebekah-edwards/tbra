import Link from "next/link";
import { NoCover } from "@/components/no-cover";

interface BookHeaderProps {
  title: string;
  coverImageUrl: string | null;
  authors: { id: string; name: string; slug?: string | null; role: string }[];
  genres: string[];
  publicationYear: number | null;
  pages: number | null;
  audioLengthMinutes?: number | null;
  showAudioLength?: boolean;
  isManuallyAdded?: boolean;
  topLevelGenre?: string | null;
  ageCategory?: string | null;
  pacing?: string | null;
  onCoverEditClick?: () => void;
  seriesName?: string | null;
  seriesSlug?: string | null;
  seriesId?: string | null;
  positionInSeries?: number | null;
  parentFranchise?: { id: string; name: string; slug: string | null } | null;
  /** Optional slot rendered absolutely at the bottom-right corner of the card */
  shareButton?: React.ReactNode;
}

const PACING_CONFIG: Record<string, { label: string; style: string }> = {
  slow: { label: "Slow-paced", style: "border-red-500/30 bg-red-500/10 text-red-400 pacing-pill-slow" },
  medium: { label: "Medium-paced", style: "border-amber-500/30 bg-amber-500/10 text-amber-400 pacing-pill-medium" },
  fast: { label: "Fast-paced", style: "border-accent/30 bg-accent/10 text-accent pacing-pill-fast" },
};

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
  topLevelGenre,
  ageCategory,
  pacing,
  onCoverEditClick,
  seriesName,
  seriesSlug,
  seriesId,
  positionInSeries,
  parentFranchise,
  shareButton,
}: BookHeaderProps) {
  const formatMeta = showAudioLength
    ? (audioLengthMinutes
        ? `${Math.floor(audioLengthMinutes / 60)}h ${audioLengthMinutes % 60}m`
        : "Audiobook")
    : pages
      ? `${pages} pages`
      : null;

  return (
    <div className="relative overflow-visible lg:w-[48%] lg:flex-shrink-0">
      {/* Full-bleed color spill — escapes container to viewport edges */}
      <div className="hero-bleed hero-bleed-fade absolute -top-20 bottom-0 overflow-hidden">
        {coverImageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={coverImageUrl}
            alt=""
            aria-hidden
            className="book-hero-img absolute inset-0 h-full w-full scale-150 object-cover blur-3xl opacity-60 saturate-150 brightness-110"
          />
        ) : (
          <div className="absolute inset-0 no-cover-gradient opacity-40" />
        )}
        {/* Fade to background at bottom */}
        <div className="book-hero-fade-bottom absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
        {/* Fade to background at sides */}
        <div className="book-hero-fade-sides absolute inset-0 bg-gradient-to-r from-background/50 via-transparent to-background/50" />
        {/* Desktop: hard fade to background on right side so blur doesn't extend behind action buttons */}
        <div className="hidden lg:block absolute inset-0 bg-gradient-to-r from-transparent via-transparent via-[70%] to-background" />
      </div>

      {/* Card with darker background */}
      <div className="relative rounded-2xl overflow-visible">
        {(topLevelGenre || ageCategory) && (
          <div className="absolute -top-3 right-4 z-20 flex gap-1.5">
            {topLevelGenre && (
              <span className="rounded-full bg-accent px-3 py-1 text-xs font-semibold text-black shadow-md">
                {topLevelGenre}
              </span>
            )}
            {ageCategory && (
              <span className="rounded-full bg-purple-600 px-3 py-1 text-xs font-semibold text-white shadow-md">
                {ageCategory}
              </span>
            )}
          </div>
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
                className="book-card-bg-img absolute inset-0 h-full w-full scale-150 object-cover blur-2xl opacity-80 saturate-150 brightness-110"
              />
              <div className="absolute inset-0 book-header-overlay" />
            </>
          )}
          {!coverImageUrl && (
            <>
              <div className="absolute inset-0 no-cover-gradient" />
              <div className="absolute inset-0 no-cover-pattern" />
              <div className="absolute inset-0 book-header-overlay" />
            </>
          )}
        </div>

        {/* Share button — anchored at bottom-right of the card */}
        {shareButton && (
          <div className="absolute bottom-2 right-2 z-20">
            {shareButton}
          </div>
        )}

        {/* Side-by-side layout: cover left, info right */}
        <div className="relative z-10 flex gap-4 sm:gap-6 p-4 sm:p-6">
          <div className="relative flex-shrink-0 flex items-center">
            {coverImageUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={coverImageUrl}
                alt={`Cover of ${title}`}
                className="w-[110px] sm:w-[140px] lg:w-[180px] h-auto rounded-lg object-contain shadow-xl"
              />
            ) : (
              <NoCover title={title} className="w-[110px] sm:w-[140px] lg:w-[180px] h-[165px] sm:h-[210px] lg:h-[270px] shadow-xl" size="lg" />
            )}
            {onCoverEditClick && (
              <button
                onClick={onCoverEditClick}
                className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-surface border border-border flex items-center justify-center text-muted hover:text-foreground transition-colors shadow-md z-10"
                title="Change cover"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                </svg>
              </button>
            )}
          </div>

          <div className="flex flex-col justify-center min-w-0">
            <h1 className="text-xl font-bold tracking-tight drop-shadow-sm sm:text-2xl text-foreground book-header-text">
              {title}
            </h1>

            {authors.length > 0 && (
              <p className="mt-1 text-sm book-header-text-sub">
                {authors.map((a, i) => (
                  <span key={a.id}>
                    {i > 0 && ", "}
                    <Link
                      href={a.slug ? `/author/${a.slug}` : `/author/${a.id}`}
                      className="underline book-header-link transition-colors"
                    >
                      {a.name}
                    </Link>
                  </span>
                ))}
              </p>
            )}

            {seriesName && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Link
                  href={seriesSlug ? `/series/${seriesSlug}` : `/search?series=${seriesId}`}
                  className="inline-flex items-center gap-0.5 text-xs text-neon-blue hover:text-neon-blue/80 transition-colors"
                >
                  #{positionInSeries ?? "?"} in {seriesName}
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </Link>
                {parentFranchise && (
                  <Link
                    href={`/series/${parentFranchise.slug || parentFranchise.id}`}
                    className="inline-flex items-center gap-0.5 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Part of {parentFranchise.name}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </Link>
                )}
              </div>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm book-header-text-muted">
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

            {(genres.length > 0 || isManuallyAdded || pacing) && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {genres.map((genre) => (
                  <Link
                    key={genre}
                    href={`/browse?genre=${encodeURIComponent(genre)}`}
                    className="rounded-full book-header-pill px-2.5 py-0.5 text-xs font-medium hover:brightness-125 transition-all"
                  >
                    {genre}
                  </Link>
                ))}
                {pacing && PACING_CONFIG[pacing] && (
                  <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium inline-flex items-center gap-1 ${PACING_CONFIG[pacing].style}`}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    {PACING_CONFIG[pacing].label}
                  </span>
                )}
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
