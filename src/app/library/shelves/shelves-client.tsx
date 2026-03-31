"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ShelfCard } from "@/components/shelves/shelf-card";
import { ShelfCoverMosaic } from "@/components/shelves/shelf-cover-mosaic";
import { CreateShelfModal } from "@/components/shelves/create-shelf-modal";
import { PremiumBadge } from "@/components/premium-gate";
import { reorderShelves } from "@/lib/actions/shelves";
import type { ShelfSummary, FollowedShelf } from "@/lib/queries/shelves";
import type { FavoriteBook } from "@/lib/queries/favorites";

interface ShelvesClientProps {
  shelves: ShelfSummary[];
  followedShelves: FollowedShelf[];
  isPremium: boolean;
  favorites: FavoriteBook[];
  username: string | null;
}

function SortableShelfCard({ shelf, linkBase, editHref }: { shelf: ShelfSummary; linkBase: string; editHref: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: shelf.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        {...attributes}
        {...listeners}
        className="touch-none p-1 text-muted/40 hover:text-muted cursor-grab active:cursor-grabbing shrink-0"
        aria-label="Drag to reorder"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="5" r="1.5" /><circle cx="15" cy="5" r="1.5" />
          <circle cx="9" cy="12" r="1.5" /><circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="19" r="1.5" /><circle cx="15" cy="19" r="1.5" />
        </svg>
      </button>
      <div className="flex-1 min-w-0">
        <ShelfCard shelf={shelf} linkBase={linkBase} editHref={editHref} />
      </div>
    </div>
  );
}

export function ShelvesClient({ shelves: initialShelves, followedShelves, isPremium, favorites, username }: ShelvesClientProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [orderedShelves, setOrderedShelves] = useState(initialShelves);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = orderedShelves.findIndex((s) => s.id === active.id);
    const newIndex = orderedShelves.findIndex((s) => s.id === over.id);
    const reordered = arrayMove(orderedShelves, oldIndex, newIndex);
    setOrderedShelves(reordered);

    startTransition(async () => {
      await reorderShelves(reordered.map((s) => s.id));
    });
  }

  const topShelfCovers = favorites
    .filter((f) => f.coverImageUrl)
    .slice(0, 12)
    .map((f) => f.coverImageUrl!);

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

      {/* Top Shelf — always visible for all users */}
      <Link
        href="/library/shelves/top-shelf"
        className="block mb-4"
      >
        <div
          className="rounded-xl border transition-all hover:scale-[1.01] active:scale-[0.99]"
          style={{
            background: "linear-gradient(to bottom, #f59e0b12, #f59e0b22)",
            borderColor: "#f59e0b30",
          }}
        >
          <div className="flex items-start gap-3 px-4 pt-4 pb-2.5">
            {topShelfCovers.length > 0 ? (
              <ShelfCoverMosaic
                coverUrls={topShelfCovers}
                color="#f59e0b"
                maxCovers={3}
              />
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-amber-500/10">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
              </div>
            )}
            <div className="flex-1 min-w-0 py-0.5">
              <div className="flex items-center gap-2">
                <h3 className="font-heading text-sm font-bold text-foreground truncate">
                  Top Shelf
                </h3>
                <span className="text-[10px] text-amber-500/60 font-medium">★</span>
              </div>
              <p className="text-[11px] text-muted mt-0.5">
                {favorites.length} {favorites.length === 1 ? "book" : "books"} · Your all-time favorites
              </p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted/40 mt-2 flex-shrink-0">
              <path d="M9 18l6-6-6-6" />
            </svg>
          </div>

          {/* Shelf edge */}
          <div
            className="h-[5px] shadow-[inset_0_2px_3px_rgba(0,0,0,0.1)]"
            style={{ background: "linear-gradient(to bottom, #f59e0b30, #f59e0b45)" }}
          />
          <div className="h-1.5" />
        </div>
      </Link>

      {/* Custom shelves — premium only */}
      {isPremium ? (
        orderedShelves.length === 0 ? (
          /* Empty state */
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-accent">
                <path d="M4 4h2v16H4z" />
                <path d="M8 4h2v16H8z" />
                <path d="M13 4l2 16" />
                <path d="M18 4l2 16" />
              </svg>
            </div>
            <h3 className="font-heading text-base font-bold text-foreground">No custom shelves yet</h3>
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
          /* Shelf grid — drag to reorder */
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={orderedShelves.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {orderedShelves.map((shelf) => (
                  <SortableShelfCard
                    key={shelf.id}
                    shelf={shelf}
                    linkBase={username && shelf.isPublic ? `/u/${username}/shelves` : `/library/shelves`}
                    editHref={`/library/shelves/${shelf.slug}`}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )
      ) : (
        /* Upgrade prompt for free users */
        <div className="rounded-xl border border-dashed border-neon-purple/20 bg-neon-purple/5 p-6 text-center">
          <p className="text-sm text-muted mb-2">
            Want to create custom shelves?
          </p>
          <Link
            href="/upgrade"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-neon-purple hover:text-neon-purple/80 transition-colors"
          >
            Upgrade to Based Reader
            <PremiumBadge />
          </Link>
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
