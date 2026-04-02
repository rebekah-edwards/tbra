"use client";

import { useState, useTransition, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
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
import { NoCover } from "@/components/no-cover";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CreateShelfModal } from "@/components/shelves/create-shelf-modal";
import {
  removeBookFromShelf,
  bulkRemoveFromShelf,
  reorderShelfBooks,
  deleteShelf,
  addBookToShelf,
  updateShelfBookNote,
} from "@/lib/actions/shelves";
import type { ShelfDetail, ShelfBook } from "@/lib/queries/shelves";
import type { UserBookWithDetails } from "@/lib/queries/reading-state";

interface ShelfDetailClientProps {
  shelf: ShelfDetail;
  allBooks: UserBookWithDetails[];
  isPremium: boolean;
  username?: string;
}

// ─── Book item within shelf ───

function ShelfBookItem({
  book,
  shelfId,
  onRemove,
  selected,
  onToggleSelect,
  selectMode,
}: {
  book: ShelfBook;
  shelfId: string;
  onRemove: (bookId: string) => void;
  selected?: boolean;
  onToggleSelect?: (bookId: string) => void;
  selectMode?: boolean;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteText, setNoteText] = useState(book.note || "");
  const [notePending, startNoteTransition] = useTransition();

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: book.bookId, disabled: selectMode || editingNote });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  function saveNote() {
    const trimmed = noteText.trim();
    startNoteTransition(async () => {
      await updateShelfBookNote(shelfId, book.bookId, trimmed || null);
      setEditingNote(false);
    });
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 py-3 px-1 border-b border-border/50 last:border-0 ${isDragging ? "bg-surface-alt/50 rounded-lg" : ""}`}
    >
      {/* Drag handle */}
      {!selectMode && (
        <div
          {...attributes}
          {...listeners}
          className="touch-none cursor-grab active:cursor-grabbing p-1 text-muted/30 hover:text-muted/60 shrink-0"
          title="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="9" cy="6" r="1.5" />
            <circle cx="15" cy="6" r="1.5" />
            <circle cx="9" cy="12" r="1.5" />
            <circle cx="15" cy="12" r="1.5" />
            <circle cx="9" cy="18" r="1.5" />
            <circle cx="15" cy="18" r="1.5" />
          </svg>
        </div>
      )}
      {selectMode && (
        <button
          onClick={() => onToggleSelect?.(book.bookId)}
          className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
            selected ? "bg-accent border-accent" : "border-border"
          }`}
        >
          {selected && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
      )}
      <Link href={`/book/${book.slug || book.bookId}`} className="shrink-0">
        {book.coverImageUrl ? (
          <Image
            src={book.coverImageUrl}
            alt={`Cover of ${book.title}`}
            width={48}
            height={72}
            className="h-[72px] w-[48px] rounded-sm object-cover shadow-sm"
          />
        ) : (
          <NoCover title={book.title} className="h-[72px] w-[48px] rounded-sm" size="sm" />
        )}
      </Link>
      <div className="flex-1 min-w-0">
        <Link href={`/book/${book.slug || book.bookId}`}>
          <h4 className="text-sm font-medium text-foreground truncate">{book.title}</h4>
          <p className="text-xs text-muted truncate">{book.authors.join(", ")}</p>
        </Link>
        {editingNote ? (
          <div className="mt-1.5 flex items-center gap-1.5">
            <input
              type="text"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note..."
              className="flex-1 rounded border border-border bg-surface-alt px-2 py-1 text-[11px] text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent"
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter") saveNote(); if (e.key === "Escape") setEditingNote(false); }}
            />
            <button onClick={saveNote} disabled={notePending} className="text-[10px] font-medium text-accent">
              {notePending ? "..." : "Save"}
            </button>
          </div>
        ) : book.note ? (
          <button
            onClick={() => setEditingNote(true)}
            className="text-[11px] text-muted/70 mt-1 italic line-clamp-1 text-left hover:text-muted transition-colors"
          >
            {book.note}
          </button>
        ) : (
          <button
            onClick={() => setEditingNote(true)}
            className="text-[10px] text-muted/40 mt-1 hover:text-muted transition-colors"
          >
            + Add note
          </button>
        )}
      </div>
      {!selectMode && (
        !showConfirm ? (
          <button
            onClick={() => setShowConfirm(true)}
            className="p-1.5 rounded-lg hover:bg-surface-alt transition-colors text-muted/50 hover:text-red-400 shrink-0"
            title="Remove from shelf"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        ) : (
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => { onRemove(book.bookId); setShowConfirm(false); }}
              className="px-2 py-1 rounded text-[11px] font-medium bg-red-500/15 text-red-400 hover:bg-red-500/25 transition-colors"
            >
              Remove
            </button>
            <button
              onClick={() => setShowConfirm(false)}
              className="px-2 py-1 rounded text-[11px] font-medium text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )
      )}
    </div>
  );
}

// ─── Add Books Modal ───

function AddBooksModal({
  open,
  onClose,
  shelfId,
  shelfBookIds,
  allBooks,
  onBookAdded,
  onBookRemoved,
}: {
  open: boolean;
  onClose: () => void;
  shelfId: string;
  shelfBookIds: Set<string>;
  allBooks: UserBookWithDetails[];
  onBookAdded?: (bookId: string) => void;
  onBookRemoved?: (bookId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [pending, startTransition] = useTransition();
  // Local optimistic state that layers on top of the parent's shelfBookIds
  const [localAdded, setLocalAdded] = useState<Set<string>>(new Set());
  const [localRemoved, setLocalRemoved] = useState<Set<string>>(new Set());

  // Effective membership: parent state + local optimistic adds - local optimistic removes
  function isOnShelf(bookId: string): boolean {
    if (localRemoved.has(bookId)) return false;
    if (localAdded.has(bookId)) return true;
    return shelfBookIds.has(bookId);
  }

  const filtered = search.trim()
    ? allBooks.filter(
        (b) =>
          b.title.toLowerCase().includes(search.toLowerCase()) ||
          b.authors.some((a) => a.toLowerCase().includes(search.toLowerCase())),
      )
    : allBooks.slice(0, 50);

  function handleToggle(bookId: string) {
    const currentlyOnShelf = isOnShelf(bookId);

    // Optimistic update
    if (currentlyOnShelf) {
      setLocalAdded((prev) => { const next = new Set(prev); next.delete(bookId); return next; });
      setLocalRemoved((prev) => new Set(prev).add(bookId));
    } else {
      setLocalRemoved((prev) => { const next = new Set(prev); next.delete(bookId); return next; });
      setLocalAdded((prev) => new Set(prev).add(bookId));
    }

    startTransition(async () => {
      if (currentlyOnShelf) {
        await removeBookFromShelf(shelfId, bookId);
        onBookRemoved?.(bookId);
      } else {
        await addBookToShelf(shelfId, bookId);
        onBookAdded?.(bookId);
      }
    });
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Add Books">
      <div className="p-4 pb-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search your library..."
          className="w-full rounded-lg border border-border bg-surface-alt px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent"
          autoFocus
        />
      </div>
      <div className="px-4 pb-4 max-h-[50vh] overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">No books found</p>
        ) : (
          filtered.map((book) => {
            const bookOnShelf = isOnShelf(book.id);
            return (
              <button
                key={book.id}
                onClick={() => handleToggle(book.id)}
                disabled={pending}
                className="flex items-center gap-3 w-full py-2.5 px-1 text-left hover:bg-surface-alt/50 rounded-lg transition-colors disabled:opacity-50"
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
                  <p className="text-xs text-muted truncate">{book.authors.join(", ")}</p>
                </div>
                <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                  bookOnShelf ? "bg-accent border-accent" : "border-border"
                }`}>
                  {bookOnShelf && (
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="black" strokeWidth="3">
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

// ─── Main Shelf Detail ───

export function ShelfDetailClient({ shelf: initialShelf, allBooks, isPremium, username }: ShelfDetailClientProps) {
  const router = useRouter();
  const [books, setBooks] = useState(initialShelf.books);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedBooks, setSelectedBooks] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const shelf = { ...initialShelf, books };

  const shelfBookIds = new Set(books.map((b) => b.bookId));
  const accentColor = shelf.color || "#d97706";

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = books.findIndex((b) => b.bookId === active.id);
    const newIndex = books.findIndex((b) => b.bookId === over.id);
    const reordered = arrayMove(books, oldIndex, newIndex).map((b, i) => ({ ...b, position: i + 1 }));
    setBooks(reordered);

    startTransition(async () => {
      await reorderShelfBooks(shelf.id, reordered.map((b) => b.bookId));
    });
  }

  function handleRemoveBook(bookId: string) {
    setBooks((prev) => prev.filter((b) => b.bookId !== bookId));
    startTransition(async () => {
      await removeBookFromShelf(shelf.id, bookId);
    });
  }

  function toggleSelectBook(bookId: string) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  }

  function handleBulkRemove() {
    const toRemove = [...selectedBooks];
    setBooks((prev) => prev.filter((b) => !selectedBooks.has(b.bookId)));
    setSelectedBooks(new Set());
    setSelectMode(false);
    startTransition(async () => {
      await bulkRemoveFromShelf(shelf.id, toRemove);
    });
  }

  function handleDelete() {
    startTransition(async () => {
      await deleteShelf(shelf.id);
      router.push("/library/shelves");
    });
  }

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <button
          onClick={() => router.back()}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-alt transition-colors text-muted hover:text-foreground"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-foreground text-xl font-bold tracking-tight truncate">
            {shelf.name}
          </h1>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setEditOpen(true)}
            className="p-2 rounded-lg hover:bg-surface-alt transition-colors text-muted hover:text-foreground"
            title="Edit shelf"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          {shelf.isPublic && (
            <button
              onClick={() => {
                const base = window.location.origin;
                const url = username ? `${base}/u/${username}/shelves/${shelf.slug}` : window.location.href;
                navigator.clipboard.writeText(url).then(() => {
                  setShareCopied(true);
                  setTimeout(() => setShareCopied(false), 2000);
                });
              }}
              className="p-2 rounded-lg hover:bg-surface-alt transition-colors text-muted hover:text-foreground"
              title="Copy share link"
            >
              {shareCopied ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-accent">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Description & meta */}
      <div className="mb-4 flex items-center gap-2">
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ background: accentColor }}
        />
        <span className="text-xs text-muted">
          {shelf.books.length} {shelf.books.length === 1 ? "book" : "books"}
        </span>
        {shelf.isPublic && (
          <span className="text-[10px] text-muted/60 bg-surface-alt rounded-full px-1.5 py-0.5">
            Public
          </span>
        )}
      </div>
      {shelf.description && (
        <p className="text-sm text-muted mb-4">{shelf.description}</p>
      )}

      {/* Action bar */}
      {selectMode ? (
        <div className="flex items-center gap-2 mb-4">
          <span className="text-xs text-muted flex-1">
            {selectedBooks.size} selected
          </span>
          <button
            onClick={handleBulkRemove}
            disabled={selectedBooks.size === 0 || pending}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs font-medium text-red-400 transition-all hover:bg-red-500/20 disabled:opacity-40"
          >
            Remove Selected
          </button>
          <button
            onClick={() => { setSelectMode(false); setSelectedBooks(new Set()); }}
            className="px-3 py-2 rounded-lg text-xs font-medium text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 rounded-lg bg-accent/10 border border-accent/20 px-3 py-2 text-xs font-medium text-accent transition-all hover:bg-accent/20"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Add Books
          </button>
          {shelf.books.length > 0 && (
            <button
              onClick={() => setSelectMode(true)}
              className="flex items-center gap-1.5 rounded-lg bg-surface-alt border border-border px-3 py-2 text-xs font-medium text-muted hover:text-foreground transition-all"
            >
              Select
            </button>
          )}
          <button
            onClick={() => setDeleteConfirm(true)}
            className="flex items-center gap-1.5 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-xs font-medium text-red-400 transition-all hover:bg-red-500/20"
          >
            Delete Shelf
          </button>
        </div>
      )}

      {/* Delete confirm */}
      {deleteConfirm && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 mb-4">
          <p className="text-sm text-foreground font-medium">Delete "{shelf.name}"?</p>
          <p className="text-xs text-muted mt-1">This will remove the shelf and all book assignments. Your books are not affected.</p>
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={handleDelete}
              disabled={pending}
              className="px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
            >
              {pending ? "Deleting..." : "Yes, Delete"}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Book list */}
      {shelf.books.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">No books on this shelf yet.</p>
          <p className="mt-1 text-xs text-muted/60">
            Add some from any book page, or use the Add Books button above.
          </p>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext items={books.map((b) => b.bookId)} strategy={verticalListSortingStrategy}>
            <div className="rounded-xl border border-border bg-surface/50 px-3">
              {books.map((book) => (
                <ShelfBookItem
                  key={book.bookId}
                  book={book}
                  shelfId={shelf.id}
                  onRemove={handleRemoveBook}
                  selectMode={selectMode}
                  selected={selectedBooks.has(book.bookId)}
                  onToggleSelect={toggleSelectBook}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* Edit modal */}
      <CreateShelfModal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        editShelf={{
          id: shelf.id,
          name: shelf.name,
          description: shelf.description,
          color: shelf.color,
          isPublic: shelf.isPublic,
        }}
        isPremium={isPremium}
        onCreated={(slug) => {
          if (slug !== shelf.slug) router.push(`/library/shelves/${slug}`);
        }}
      />

      {/* Add books modal */}
      <AddBooksModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        shelfId={shelf.id}
        shelfBookIds={shelfBookIds}
        allBooks={allBooks}
        onBookAdded={(bookId) => {
          const bookData = allBooks.find((b) => b.id === bookId);
          if (bookData) {
            setBooks((prev) => {
              if (prev.some((b) => b.bookId === bookId)) return prev;
              return [...prev, {
                bookId,
                title: bookData.title,
                slug: bookData.slug,
                coverImageUrl: bookData.coverImageUrl,
                authors: bookData.authors,
                position: prev.length + 1,
                note: null,
                state: bookData.state,
                addedAt: new Date().toISOString(),
                userRating: bookData.userRating,
              }];
            });
          }
        }}
        onBookRemoved={(bookId) => {
          setBooks((prev) => prev.filter((b) => b.bookId !== bookId));
        }}
      />
    </div>
  );
}
