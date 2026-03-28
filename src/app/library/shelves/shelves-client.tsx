"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ShelfCard } from "@/components/shelves/shelf-card";
import { ShelfCoverMosaic } from "@/components/shelves/shelf-cover-mosaic";
import { CreateShelfModal } from "@/components/shelves/create-shelf-modal";
import { PremiumGate, PremiumBadge } from "@/components/premium-gate";
import type { ShelfSummary, FollowedShelf } from "@/lib/queries/shelves";

interface ShelvesClientProps {
  shelves: ShelfSummary[];
  followedShelves: FollowedShelf[];
  isPremium: boolean;
}

export function ShelvesClient({ shelves, followedShelves, isPremium }: ShelvesClientProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const router = useRouter();

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/library"
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-alt transition-colors text-muted hover:text-foreground"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
          <h1 className="text-foreground text-2xl font-bold tracking-tight">
            My Shelves
          </h1>
        </div>
        {isPremium && (
          <button
            onClick={() => setCreateOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-black transition-all hover:brightness-110"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Shelf
          </button>
        )}
      </div>

      {/* Premium gate for non-premium users */}
      {!isPremium ? (
        <PremiumGate isPremium={false} featureName="Custom Shelves" />
      ) : shelves.length === 0 ? (
        /* Empty state */
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-accent">
              <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
            </svg>
          </div>
          <h3 className="font-heading text-base font-bold text-foreground">No shelves yet</h3>
          <p className="mt-1 text-sm text-muted">
            Create your first shelf to organize books into custom lists.
          </p>
          <button
            onClick={() => setCreateOpen(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black transition-all hover:brightness-110"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Create Shelf
          </button>
        </div>
      ) : (
        /* Shelf grid */
        <div className="space-y-3">
          {shelves.map((shelf) => (
            <ShelfCard key={shelf.id} shelf={shelf} />
          ))}
        </div>
      )}

      {/* Following section — visible to all users (free feature) */}
      {followedShelves.length > 0 && (
        <div className="mt-8">
          <h2 className="section-heading text-sm mb-3">Following</h2>
          <div className="space-y-3">
            {followedShelves.map((shelf) => (
              <Link
                key={shelf.id}
                href={`/u/${shelf.ownerUsername}/shelves/${shelf.slug}`}
                className="block"
              >
                <div
                  className="rounded-xl border transition-all hover:scale-[1.01] active:scale-[0.99]"
                  style={{
                    background: `linear-gradient(to bottom, ${shelf.color || "#d97706"}12, ${shelf.color || "#d97706"}22)`,
                    borderColor: `${shelf.color || "#d97706"}30`,
                  }}
                >
                  <div className="flex items-start gap-3 px-4 pt-4 pb-2.5">
                    <ShelfCoverMosaic
                      coverUrls={shelf.coverUrls}
                      color={shelf.color}
                      maxCovers={3}
                    />
                    <div className="flex-1 min-w-0 py-0.5">
                      <h3 className="font-heading text-sm font-bold text-foreground truncate">
                        {shelf.name}
                      </h3>
                      <p className="text-[11px] text-muted mt-0.5">
                        by {shelf.ownerDisplayName || `@${shelf.ownerUsername}`} · {shelf.bookCount} {shelf.bookCount === 1 ? "book" : "books"}
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
                    style={{ background: `linear-gradient(to bottom, ${shelf.color || "#d97706"}30, ${shelf.color || "#d97706"}45)` }}
                  />
                  <div className="h-1.5" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <CreateShelfModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(slug) => router.push(`/library/shelves/${slug}`)}
        isPremium={isPremium}
      />
    </div>
  );
}
