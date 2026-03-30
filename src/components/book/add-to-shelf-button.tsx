"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { toggleBookOnShelf, createShelf } from "@/lib/actions/shelves";
import { toggleFavorite } from "@/lib/actions/favorites";
import { PremiumBadge } from "@/components/premium-gate";
import type { ShelfSummary } from "@/lib/queries/shelves";
import type { BookShelfMembership } from "@/lib/queries/shelves";

interface AddToShelfButtonProps {
  bookId: string;
  shelves: ShelfSummary[];
  bookShelves: BookShelfMembership[];
  isPremium: boolean;
  isFavorited?: boolean;
}

export function AddToShelfButton({ bookId, shelves, bookShelves, isPremium, isFavorited: initialFavorited = false }: AddToShelfButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [favorited, setFavorited] = useState(initialFavorited);

  // Track which shelves the book is on (optimistic)
  const [memberShelfIds, setMemberShelfIds] = useState<Set<string>>(
    () => new Set(bookShelves.map((s) => s.shelfId)),
  );

  const shelfCount = memberShelfIds.size + (favorited ? 1 : 0);

  function handleToggle(shelfId: string) {
    const isOnShelf = memberShelfIds.has(shelfId);
    // Optimistic update
    setMemberShelfIds((prev) => {
      const next = new Set(prev);
      if (isOnShelf) next.delete(shelfId);
      else next.add(shelfId);
      return next;
    });

    startTransition(async () => {
      await toggleBookOnShelf(shelfId, bookId);
    });
  }

  // No longer gate the entire button — Top Shelf is free, custom shelves are premium

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center justify-center gap-1.5 w-full rounded-xl border-2 py-3 px-2 text-sm font-semibold whitespace-nowrap transition-all ${
          shelfCount > 0
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-border bg-surface-alt text-muted hover:text-foreground hover:border-border/80"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
        </svg>
        {shelfCount > 0 ? `Shelves · ${shelfCount}` : "Shelves"}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Shelves">
        <div className="px-4 pb-4">
          {/* Top Shelf toggle */}
          <button
            onClick={() => {
              const newState = !favorited;
              setFavorited(newState);
              startTransition(async () => {
                const result = await toggleFavorite(bookId);
                if (result.success) setFavorited(result.isFavorited);
              });
            }}
            disabled={pending}
            className="flex items-center gap-3 w-full py-3 px-1 text-left hover:bg-surface-alt/50 rounded-lg transition-colors disabled:opacity-50 border-b border-border/30"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={favorited ? "#f59e0b" : "none"} stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-foreground">Top Shelf</p>
              <p className="text-[11px] text-muted">Your all-time favorites</p>
            </div>
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
              favorited ? "bg-amber-500 border-amber-500" : "border-border"
            }`}>
              {favorited && (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </div>
          </button>

          {/* Custom shelves */}
          {shelves.length === 0 && !isPremium ? (
            <Link
              href="/upgrade"
              className="flex items-center gap-2 py-4 text-sm text-neon-purple/70"
              onClick={() => setOpen(false)}
            >
              Create custom shelves <PremiumBadge />
            </Link>
          ) : shelves.length === 0 ? (
            <div className="py-4 text-center">
              <p className="text-sm text-muted">No custom shelves yet.</p>
              <Link
                href="/library/shelves"
                className="mt-2 inline-block text-sm font-medium text-accent hover:text-accent-dark"
                onClick={() => setOpen(false)}
              >
                Create your first shelf →
              </Link>
            </div>
          ) : (
            <>
              {shelves.map((shelf) => {
                const isOnShelf = memberShelfIds.has(shelf.id);
                return (
                  <button
                    key={shelf.id}
                    onClick={() => handleToggle(shelf.id)}
                    disabled={pending}
                    className="flex items-center gap-3 w-full py-3 px-1 text-left hover:bg-surface-alt/50 rounded-lg transition-colors disabled:opacity-50 border-b border-border/30 last:border-0"
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: shelf.color || "#d97706" }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{shelf.name}</p>
                      <p className="text-[11px] text-muted">
                        {shelf.bookCount} {shelf.bookCount === 1 ? "book" : "books"}
                      </p>
                    </div>
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                      isOnShelf ? "bg-accent border-accent" : "border-border"
                    }`}>
                      {isOnShelf && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
              <Link
                href="/library/shelves"
                className="block mt-3 py-2 text-center text-xs font-medium text-accent hover:text-accent-dark"
                onClick={() => setOpen(false)}
              >
                Manage Shelves →
              </Link>
            </>
          )}
        </div>
      </BottomSheet>
    </>
  );
}
