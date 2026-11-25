"use client";

import Link from "next/link";
import Image from "next/image";
import { NoCover } from "@/components/no-cover";

interface ChildSeries {
  id: string;
  name: string;
  slug: string | null;
  bookCount: number;
  coverImageUrl: string | null;
}

interface FranchiseSeriesGridProps {
  franchiseName: string;
  franchiseId: string;
  childSeries: ChildSeries[];
  isAdmin: boolean;
  /**
   * Rendered INSIDE a series page that also has its own books (a real series
   * with spin-offs, e.g. Animorphs → Megamorphs). Drops the page h1 — the
   * book list owns it — and uses smaller cards when there are only a few.
   */
  embedded?: boolean;
}

export function FranchiseSeriesGrid({
  franchiseName,
  franchiseId,
  childSeries,
  isAdmin,
  embedded = false,
}: FranchiseSeriesGridProps) {
  const compact = embedded && childSeries.length <= 3;
  return (
    <div>
      <div className={`flex items-center justify-between ${embedded ? "mb-3" : "mb-6"}`}>
        <div>
          {embedded ? (
            <p className="eyebrow">Series in this franchise</p>
          ) : (
            <>
              <p className="eyebrow">Franchise</p>
              <h1 className="mt-1 font-heading text-[24px] font-bold leading-tight tracking-tight text-foreground">{franchiseName}</h1>
            </>
          )}
          <p className={`text-muted mt-1 ${embedded ? "text-xs" : "text-sm"}`}>
            {childSeries.length} series ·{" "}
            {childSeries.reduce((sum, s) => sum + s.bookCount, 0)} books
          </p>
        </div>
      </div>

      <div
        className={
          compact
            ? "grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3"
            : "grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4"
        }
      >
        {childSeries.map((child) => (
          <Link
            key={child.id}
            href={`/series/${child.slug || child.id}`}
            className="group overflow-hidden rounded-[18px] border border-foreground/10 bg-surface/80 backdrop-blur-md transition-colors hover:border-foreground/25"
          >
            {/* Cover */}
            <div className="aspect-[2/3] relative bg-surface-alt overflow-hidden">
              {child.coverImageUrl ? (
                <Image
                  src={child.coverImageUrl}
                  alt={`Cover from ${child.name}`}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-300"
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                />
              ) : (
                <NoCover title={child.name} className="w-full h-full" />
              )}
            </div>

            {/* Info */}
            <div className="p-3">
              <h3 className="text-sm font-semibold leading-tight line-clamp-2 group-hover:text-neon-blue transition-colors">
                {child.name}
              </h3>
              <p className="text-xs text-muted mt-1">
                {child.bookCount} {child.bookCount === 1 ? "book" : "books"}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
