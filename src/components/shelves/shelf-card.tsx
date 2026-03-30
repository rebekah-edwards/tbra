"use client";

import Link from "next/link";
import { ShelfCoverMosaic } from "./shelf-cover-mosaic";
import type { ShelfSummary } from "@/lib/queries/shelves";

interface ShelfCardProps {
  shelf: ShelfSummary;
  /** Link base for the main tap (public view) */
  linkBase?: string;
  /** Show an edit button linking to the edit page */
  editHref?: string;
}

export function ShelfCard({ shelf, linkBase = "/library/shelves", editHref }: ShelfCardProps) {
  const accentColor = shelf.color || "#d97706";

  return (
    <div>
      <div
        className="relative rounded-xl border transition-all hover:scale-[1.01] active:scale-[0.99]"
        style={{
          background: `linear-gradient(to bottom, ${accentColor}12, ${accentColor}22)`,
          borderColor: `${accentColor}30`,
        }}
      >
        <Link
          href={`${linkBase}/${shelf.slug}`}
          className="block"
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

          {/* Shelf edge */}
          <div
            className="h-[5px] shadow-[inset_0_2px_3px_rgba(0,0,0,0.1)]"
            style={{ background: `linear-gradient(to bottom, ${accentColor}30, ${accentColor}45)` }}
          />
          <div className="h-1.5" />
        </Link>

        {/* Edit button — overlaid top-right */}
        {editHref && (
          <Link
            href={editHref}
            className="absolute top-3 right-3 p-1.5 rounded-lg bg-surface/80 border border-border/50 text-muted hover:text-foreground hover:bg-surface transition-colors backdrop-blur-sm z-10"
            title="Edit shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </Link>
        )}
      </div>
      {/* Shelf shadow */}
      <div className="h-2 mx-2 bg-gradient-to-b from-black/10 to-transparent rounded-b-lg" />
    </div>
  );
}
