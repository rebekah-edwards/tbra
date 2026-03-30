import Image from "next/image";
import Link from "next/link";
import { NoCover } from "@/components/no-cover";
import { formatRating } from "@/lib/text-utils";

interface BookCardProps {
  id: string;
  slug?: string | null;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  isFiction?: boolean | null;
  userRating?: number | null;
  aggregateRating?: number | null;
  activeFormats?: string[];
  state?: string | null;
  hasContentConflict?: boolean;
  staggerIndex?: number;
}

export function BookCard({ id, slug, title, coverImageUrl, userRating, aggregateRating, activeFormats, state, hasContentConflict, staggerIndex }: BookCardProps) {
  const isActivelyReading = state === "currently_reading" || state === "paused";
  const isAudiobook = isActivelyReading && activeFormats?.length === 1 && activeFormats[0] === "audiobook";
  const aspect = isAudiobook ? "aspect-square" : "aspect-[2/3]";

  return (
    <Link
      href={`/book/${slug || id}`}
      className={`group block tap-scale ${staggerIndex != null && staggerIndex < 12 ? "card-stagger" : ""}`}
      style={staggerIndex != null && staggerIndex < 12 ? { "--stagger-index": staggerIndex } as React.CSSProperties : undefined}
    >
      <div className="relative">
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={`Cover of ${title}`}
            width={isAudiobook ? 120 : 120}
            height={isAudiobook ? 120 : 180}
            className={`${aspect} w-full rounded-lg object-cover book-card-cover transition-shadow`}
          />
        ) : (
          <NoCover title={title} className={`${aspect} w-full book-card-cover transition-shadow`} size="md" />
        )}
        {/* Desktop hover: show title at top to avoid rating pill overlap */}
        <div className="hidden lg:flex absolute inset-0 rounded-lg bg-black/70 opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-start p-2 pointer-events-none">
          <p className="text-[11px] font-medium text-white leading-tight line-clamp-3">
            {title}
          </p>
        </div>
        {hasContentConflict && (
          <span className="absolute top-1.5 left-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-yellow-500/90 text-black text-[11px] font-bold shadow-sm" title="Contains flagged content">
            !
          </span>
        )}
        {userRating != null && userRating > 0 ? (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
            {formatRating(userRating)} ★
          </span>
        ) : aggregateRating != null && aggregateRating > 0 ? (
          <span className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 rounded-full bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white/80 backdrop-blur-sm">
            {formatRating(aggregateRating)} ★
          </span>
        ) : null}
      </div>
    </Link>
  );
}
