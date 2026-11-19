"use client";

import Link from "next/link";
import { ShelfCoverMosaic } from "./shelf-cover-mosaic";
import { ShelfLedge } from "./shelf-ledge";
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
    // 2026-11 refresh: glass case; the shelf's colour is the dot, a thin
    // ring and the raised ledge (matches the profile shelf rows).
    <div>
      <div
        className="relative overflow-hidden rounded-[18px] border bg-surface/60 backdrop-blur-md transition-transform hover:scale-[1.01] active:scale-[0.99]"
        style={{ borderColor: `${accentColor}40` }}
      >
        <Link
          href={`${linkBase}/${shelf.slug}`}
          className="block"
        >
          <div className={`flex items-start gap-3 px-4 pt-4 pb-2.5 ${editHref ? "pr-12" : ""}`}>
            <ShelfCoverMosaic
              coverUrls={shelf.coverUrls}
              color={shelf.color}
              maxCovers={3}
            />
            <div className="flex-1 min-w-0 py-0.5">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: accentColor }} aria-hidden="true" />
                <h3 className="font-heading text-sm font-bold text-foreground truncate">
                  {shelf.name}
                </h3>
              </div>
              <p className="mt-1 flex items-center gap-2 text-xs text-muted">
                {shelf.bookCount} {shelf.bookCount === 1 ? "book" : "books"}
                {shelf.isPublic && (
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-foreground/10 bg-surface/80 px-1.5 py-0.5 text-[9px] font-semibold text-foreground">
                    <span className="h-[5px] w-[5px] rounded-full bg-neon-blue" aria-hidden="true" />
                    Public
                  </span>
                )}
              </p>
              {shelf.description && (
                <p className="text-xs text-muted/60 mt-1.5 line-clamp-2 leading-relaxed">
                  {shelf.description}
                </p>
              )}
            </div>
          </div>

          <ShelfLedge background={`${accentColor}cc`} bleed="mx-0" />
        </Link>

        {/* Edit button — overlaid top-right */}
        {editHref && (
          <Link
            href={editHref}
            className="btn-glass absolute top-3 right-3 z-10 h-8 w-8 text-muted hover:text-foreground"
            title="Edit shelf"
            onClick={(e) => e.stopPropagation()}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
            </svg>
          </Link>
        )}
      </div>
    </div>
  );
}
