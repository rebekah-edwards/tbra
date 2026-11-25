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
import { CoverArtHero, HERO_BACK_BUTTON_CLASS } from "@/components/ui/cover-art-hero";
import { BackButton } from "@/components/ui/back-button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import type { FavoriteBook } from "@/lib/queries/favorites";
import type { UserBookWithDetails } from "@/lib/queries/reading-state";
import { reorderFavorites, removeFavorite, addFavorite } from "@/lib/actions/favorites";
import { librarySearchText, librarySearchTokens, matchesLibrarySearch } from "@/lib/library-search";
import { AuthorLinks } from "@/components/book/author-links";

interface TopShelfClientProps {
  favorites: FavoriteBook[];
  allBooks: UserBookWithDetails[];
  userAvatarUrl: string | null;
}

/** The star icon the book page's Shelves button and this page share. */
function StarIcon({ size = 14, filled = false }: { size?: number; filled?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  );
}

// ─── Add Books sheet (mirrors the custom-shelf AddBooksModal) ───

function AddToTopShelfSheet({
  open,
  onClose,
  allBooks,
  favoriteIds,
  onAdd,
  onRemove,
  error,
}: {
  open: boolean;
  onClose: () => void;
  allBooks: UserBookWithDetails[];
  favoriteIds: Set<string>;
  onAdd: (book: UserBookWithDetails) => void;
  onRemove: (bookId: string) => void;
  error: string | null;
}) {
  const [search, setSearch] = useState("");

  // Same matcher as the library page search: title, author and series,
  // case- and diacritic-insensitive.
  const searchTokens = librarySearchTokens(search);
  const filtered = searchTokens.length > 0
    ? allBooks.filter((b) => matchesLibrarySearch(librarySearchText(b), searchTokens))
    : allBooks.slice(0, 50);

  return (
    <BottomSheet open={open} onClose={onClose} title="Add to Top Shelf">
      <div className="p-4 pb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your library..."
          className="field-glass w-full text-base"
          autoFocus
        />
        {error && <p className="mt-2 text-xs text-red-400" role="alert">{error}</p>}
      </div>
      <div className="px-4 pb-4 max-h-[50vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No books found</p>
        ) : (
          filtered.map((book) => {
            const onTopShelf = favoriteIds.has(book.id);
            return (
              <button
                key={book.id}
                onClick={() => (onTopShelf ? onRemove(book.id) : onAdd(book))}
                className="flex items-center gap-3 w-full py-2.5 px-1 text-left hover:bg-surface-alt/50 rounded-lg transition-colors"
              >
                {book.coverImageUrl ? (
                  <Image
                    src={book.coverImageUrl}
                    alt=""
                    width={32}
                    height={48}
                    className="h-[48px] w-[32px] rounded-sm object-cover shrink-0"
                  />
                ) : (
                  <NoCover title={book.title} className="h-[48px] w-[32px] rounded-sm" size="sm" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{book.title}</p>
                  <p className="text-xs text-muted truncate"><AuthorLinks authors={book.authors} nested /></p>
                </div>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                  onTopShelf ? "bg-amber-500 border-amber-500" : "border-border"
                }`}>
                  {onTopShelf && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })
        )}
      </div>
    </BottomSheet>
  );
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
                className="aspect-[2/3] w-full rounded-lg object-cover shadow-[0_8px_18px_rgba(0,0,0,0.4)] ring-1 ring-white/10"
              />
            ) : (
              <NoCover title={book.title} className="aspect-[2/3] w-full" size="md" />
            )}
            {/* Rating badge with avatar */}
            {book.userRating != null && book.userRating > 0 && (
              <span className="absolute bottom-1 right-1 flex items-center gap-1 rounded-full border border-white/15 bg-black/60 pl-0.5 pr-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-md">
                {userAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={userAvatarUrl} alt="" className="w-3.5 h-3.5 rounded-full object-cover flex-shrink-0" />
                ) : (
                  <span className="w-3.5 h-3.5 rounded-full bg-accent flex items-center justify-center text-black flex-shrink-0"><StarIcon size={8} filled /></span>
                )}
                <span className="text-[#fbbf24]"><StarIcon size={8} filled /></span>
                {book.userRating % 1 === 0 ? book.userRating.toFixed(0) : book.userRating.toFixed(2)}
              </span>
            )}
          </div>
        </Link>
      </div>

      {/* Title + author */}
      <p className="mt-2 font-heading text-[12px] font-bold text-foreground line-clamp-2 leading-tight">
        {book.title}
      </p>
      <p className="text-[10px] text-muted truncate">
        <AuthorLinks authors={book.authors} />
      </p>

      {/* Remove button — shown on hover/focus */}
      <button
        onClick={() => onRemove(book.id)}
        disabled={isRemoving}
        className="orb-glass absolute -top-2 -right-2 z-10 h-6 w-6 opacity-100 shadow-md transition-opacity md:opacity-0 md:group-hover:opacity-100"
        title="Remove from Top Shelf"
        aria-label={`Remove ${book.title} from Top Shelf`}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" className="text-red-400" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>
  );
}

export function TopShelfClient({ favorites: initialFavorites, allBooks, userAvatarUrl }: TopShelfClientProps) {
  const [favorites, setFavorites] = useState(initialFavorites);
  const [isPending, startTransition] = useTransition();
  const [addOpen, setAddOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const favoriteIds = new Set(favorites.map((f) => f.id));

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
    setAddError(null);
    setFavorites((prev) => prev.filter((f) => f.id !== bookId));
    startTransition(async () => {
      await removeFavorite(bookId);
    });
  }

  function handleAdd(book: UserBookWithDetails) {
    setAddError(null);
    // Optimistic: new favorites land at the end, matching addFavorite's
    // position = count + 1.
    const optimistic: FavoriteBook = {
      id: book.id,
      slug: book.slug,
      title: book.title,
      coverImageUrl: book.coverImageUrl,
      authors: book.authors,
      position: favorites.length + 1,
      seriesId: null,
      seriesPosition: null,
      userRating: book.userRating,
    };
    setFavorites((prev) => (prev.some((f) => f.id === book.id) ? prev : [...prev, optimistic]));
    startTransition(async () => {
      const result = await addFavorite(book.id);
      if (!result.success) {
        setFavorites((prev) => prev.filter((f) => f.id !== book.id));
        setAddError(result.error ?? "Couldn't add to Top Shelf.");
      }
    });
  }

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Header — cover-art hero (design refresh 2026-11) */}
      <CoverArtHero
        leading={<BackButton className={HERO_BACK_BUTTON_CLASS} />}
        eyebrow="All-time favorites"
        title="Top Shelf"
        covers={favorites.map((f) => f.coverImageUrl).filter((u): u is string => !!u)}
        stats={[
          { label: favorites.length === 1 ? "book" : "books", value: favorites.length, hue: "lime" },
        ]}
        actions={
          <button onClick={() => { setAddError(null); setAddOpen(true); }} className="btn-lime px-4 py-1.5 text-xs">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Books
          </button>
        }
      />

      {/* How to add from a book page */}
      <p className="mx-auto mb-5 mt-3.5 flex max-w-md items-start justify-center gap-1.5 text-center text-xs text-muted">
        <span className="mt-px text-amber-500"><StarIcon size={12} /></span>
        <span>
          {favorites.length > 1 && <>Drag to reorder. </>}You can also add a book from its page: tap{" "}
          <span className="font-medium text-foreground">Shelves</span>, then check{" "}
          <span className="font-medium text-foreground">Top Shelf</span>.
        </span>
      </p>

      {favorites.length === 0 ? (
        <div className="card-glass flex flex-col items-center px-6 py-9 text-center">
          <div className="orb-glass mb-3 h-14 w-14">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-500">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          </div>
          <h3 className="font-heading text-base font-bold text-foreground">No favorites yet</h3>
          <p className="mt-1 text-sm text-muted">
            Use Add Books above to pick from your library.
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

      <AddToTopShelfSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        allBooks={allBooks}
        favoriteIds={favoriteIds}
        onAdd={handleAdd}
        onRemove={handleRemove}
        error={addError}
      />
    </div>
  );
}
