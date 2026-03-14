import Image from "next/image";
import Link from "next/link";
import { StarRow } from "@/components/review/rounded-star";

interface BookCardProps {
  id: string;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
  isFiction?: boolean | null;
  userRating?: number | null;
}

export function BookCard({ id, title, coverImageUrl, authors, userRating }: BookCardProps) {
  return (
    <Link
      href={`/book/${id}`}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary/40"
    >
      <div className="relative">
        {coverImageUrl ? (
          <Image
            src={coverImageUrl}
            alt={`Cover of ${title}`}
            width={120}
            height={180}
            className="h-[180px] w-full rounded-lg object-cover"
          />
        ) : (
          <div className="flex h-[180px] w-full items-center justify-center rounded-lg bg-surface-alt text-xs text-muted">
            No cover
          </div>
        )}
      </div>
      <h3 className="line-clamp-2 text-sm font-semibold leading-tight group-hover:text-primary transition-colors">
        {title}
      </h3>
      {authors.length > 0 && (
        <p className="line-clamp-1 text-xs text-muted">
          {authors.join(", ")}
        </p>
      )}
      {userRating != null && userRating > 0 && (
        <div className="flex items-center gap-1.5">
          <StarRow rating={userRating} size={14} />
          <span className="text-xs font-medium text-foreground/70">
            {userRating % 0.25 === 0 && userRating % 0.5 !== 0
              ? userRating.toFixed(2)
              : userRating.toFixed(1)}
          </span>
        </div>
      )}
    </Link>
  );
}
