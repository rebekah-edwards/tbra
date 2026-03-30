"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Image from "next/image";
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
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { NoCover } from "@/components/no-cover";
import type { FavoriteBook } from "@/lib/queries/favorites";
import { reorderFavorites, removeFavorite } from "@/lib/actions/favorites";

interface TopShelfClientProps {
  favorites: FavoriteBook[];
  userAvatarUrl: string | null;
}

function SortableBook({
  book,
  userAvatarUrl,
  onRemove,
  isRemoving,
}: {
  book: FavoriteBook;
  userAvatarUrl: string | null;
  onRemove: (bookId: string) => void;
  isRemoving: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: book.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group">
      {/* Drag handle — entire card is draggable */}
      <div {...attributes} {...listeners} className="touch-none">
        <Link
          href={`/book/${book.slug || book.id}`}
          className="block"
          onClick={(e) => {
            // Prevent navigation when dragging
            if (isDragging) e.preventDefault();
          }}
        >
          <div className="relative">
            {book.coverImageUrl ? (
              <Image
                src={book.coverImageUrl}
                alt={`Cover of ${book.title}`}
                width={120}
                height={180}
                className="aspect-[2/3] w-full rounded-lg object-cover shadow-sm"
              />
            ) : (
              <NoCover title={book.title} className="aspect-[2/3] w-full" size="md" />
            )}
            {/* Rating badge with avatar */}
            {book.userRating != null && book.userRating > 0 && (
              <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-full bg-black/75 pl-0.5 pr-1.5 py-0.5 text-[9px] font-medium text-white backdrop-blur-sm">
                {userAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={userAvatarUrl} alt="" className="w-3.5 h-3.5 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full bg-accent/60 flex items-center justify-center text-[7px] text-black font-bold flex-shrink-0">★</span>
                )}
                {book.userRating % 1 === 0 ? book.userRating.toFixed(0) : book.userRating.toFixed(2)} ★
              </span>
            )}
          </div>
        </Link>
      </div>

      {/* Title + author */}
      <p className="mt-1.5 text-[11px] font-medium text-foreground line-clamp-2 leading-tight">
        {book.title}
      </p>
      <p className="text-[10px] text-muted truncate">
        {book.authors.join(", ")}
      </p>

      {/* Remove button — shown on hover/focus */}
      <button
        onClick={() => onRemove(book.id)}
        disabled={isRemoving}
        className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-destructive text-white flex items-center justify-center text-xs opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity shadow-md z-10"
        title="Remove from Top Shelf"
      >
        ×
      </button>
    </div>
  );
}

export function TopShelfClient({ favorites: initialFavorites, userAvatarUrl }: TopShelfClientProps) {
  const router = useRouter();
  const [favorites, setFavorites] = useState(initialFavorites);
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = favorites.findIndex((f) => f.id === active.id);
    const newIndex = favorites.findIndex((f) => f.id === over.id);
    const reordered = arrayMove(favorites, oldIndex, newIndex);
    setFavorites(reordered);

    startTransition(async () => {
      await reorderFavorites(reordered.map((f) => f.id));
    });
  }

  function handleRemove(bookId: string) {
    setFavorites((prev) => prev.filter((f) => f.id !== bookId));
    startTransition(async () => {
      await removeFavorite(bookId);
    });
  }

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-alt transition-colors text-muted hover:text-foreground"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div>
            <h1 className="text-foreground text-2xl font-bold tracking-tight">
              Top Shelf
            </h1>
            <p className="text-xs text-muted">
              {favorites.length} {favorites.length === 1 ? "book" : "books"} · Drag to reorder
            </p>
          </div>
        </div>
      </div>

      {favorites.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/10">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <h3 className="font-heading text-base font-bold text-foreground">No favorites yet</h3>
          <p className="mt-1 text-sm text-muted">
            Tap Top Shelf on any book page to add it here.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={favorites.map((f) => f.id)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {favorites.map((book) => (
                <SortableBook
                  key={book.id}
                  book={book}
                  userAvatarUrl={userAvatarUrl}
                  onRemove={handleRemove}
                  isRemoving={isPending}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {isPending && (
        <p className="text-xs text-muted mt-3 text-center">Saving...</p>
      )}
    </div>
  );
}
