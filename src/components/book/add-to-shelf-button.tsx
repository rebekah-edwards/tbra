"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { toggleBookOnShelf, createShelf } from "@/lib/actions/shelves";
import { PremiumBadge } from "@/components/premium-gate";
import type { ShelfSummary } from "@/lib/queries/shelves";
import type { BookShelfMembership } from "@/lib/queries/shelves";

interface AddToShelfButtonProps {
  bookId: string;
  shelves: ShelfSummary[];
  bookShelves: BookShelfMembership[];
  isPremium: boolean;
}

export function AddToShelfButton({ bookId, shelves, bookShelves, isPremium }: AddToShelfButtonProps) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  // Track which shelves the book is on (optimistic)
  const [memberShelfIds, setMemberShelfIds] = useState<Set<string>>(
    () => new Set(bookShelves.map((s) => s.shelfId)),
  );

  const shelfCount = memberShelfIds.size;

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

  if (!isPremium) {
    return (
      <Link
        href="/upgrade"
        className="flex items-center justify-center gap-2 w-full rounded-xl border-2 border-dashed border-neon-purple/30 bg-neon-purple/5 py-3 px-3 text-sm font-medium text-neon-purple/70 transition-all hover:bg-neon-purple/10"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
        Add to Shelf
        <PremiumBadge />
      </Link>
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center justify-center gap-2 w-full rounded-xl border-2 py-3 px-3 text-sm font-medium transition-all ${
          shelfCount > 0
            ? "border-accent/30 bg-accent/10 text-accent"
            : "border-border bg-surface-alt text-muted hover:text-foreground hover:border-border/80"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
        </svg>
        {shelfCount > 0 ? `On ${shelfCount} ${shelfCount === 1 ? "shelf" : "shelves"}` : "Add to Shelf"}
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} title="Add to Shelf">
        <div className="px-4 pb-4">
          {shelves.length === 0 ? (
            <div className="py-6 text-center">
              <p className="text-sm text-muted">You don't have any shelves yet.</p>
              <Link
                href="/library/shelves"
                className="mt-3 inline-block text-sm font-medium text-accent hover:text-accent-dark"
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
