"use client";

import Link from "next/link";
import { ShelfCoverMosaic } from "./shelf-cover-mosaic";
import type { ShelfSummary } from "@/lib/queries/shelves";

interface ShelfCardProps {
  shelf: ShelfSummary;
  /** Link base — "/library/shelves" for own, "/u/username/shelves" for public */
  linkBase?: string;
}

export function ShelfCard({ shelf, linkBase = "/library/shelves" }: ShelfCardProps) {
  const accentColor = shelf.color || "#d97706";

  return (
    <div>
      <Link
        href={`${linkBase}/${shelf.slug}`}
        className="block rounded-xl border transition-all hover:scale-[1.01] active:scale-[0.99]"
        style={{
          background: `linear-gradient(to bottom, ${accentColor}12, ${accentColor}22)`,
          borderColor: `${accentColor}30`,
        }}
      >
        <div className="flex items-start gap-3 px-4 pt-4 pb-2.5">
          <ShelfCoverMosaic
            coverUrls={shelf.coverUrls}
            color={shelf.color}
            maxCovers={3}
          />
          <div className="flex-1 min-w-0 py-0.5">
            <div className="flex items-center gap-2">
              <h3 className="font-heading text-sm font-bold text-foreground truncate">
                {shelf.name}
              </h3>
              {shelf.isPublic && (
                <span className="text-[9px] text-muted/60 bg-white/5 rounded-full px-1.5 py-0.5 shrink-0">
                  Public
                </span>
              )}
            </div>
            <p className="text-xs text-muted mt-0.5">
              {shelf.bookCount} {shelf.bookCount === 1 ? "book" : "books"}
            </p>
            {shelf.description && (
              <p className="text-xs text-muted/60 mt-1.5 line-clamp-2 leading-relaxed">
                {shelf.description}
              </p>
            )}
          </div>
        </div>

        {/* Shelf edge — full width, with space below */}
        <div
          className="h-[5px] shadow-[inset_0_2px_3px_rgba(0,0,0,0.1)]"
          style={{ background: `linear-gradient(to bottom, ${accentColor}30, ${accentColor}45)` }}
        />
        <div className="h-1.5" />
      </Link>
      {/* Shelf shadow */}
      <div className="h-2 mx-2 bg-gradient-to-b from-black/10 to-transparent rounded-b-lg" />
    </div>
  );
}
