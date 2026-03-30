"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
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
import { reorderUpNext } from "@/lib/actions/up-next";
import { formatRating } from "@/lib/text-utils";
import { NoCover } from "@/components/no-cover";

interface UpNextItem {
  bookId: string;
  slug?: string | null;
  position: number;
  title: string;
  coverImageUrl: string | null;
  authorName: string | null;
  topLevelGenre: string | null;
  pages: number | null;
  audioLengthMinutes: number | null;
  userRating: number | null;
}

function formatAudioCompact(minutes: number | null): string | null {
  if (!minutes) return null;
  const totalHours = minutes / 60;
  if (totalHours < 1) return `${minutes}m`;
  const rounded = Math.round(totalHours * 10) / 10;
  return `${rounded}h`;
}

function SortableUpNextCard({
  item,
  index,
}: {
  item: UpNextItem;
  index: number;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.bookId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 50 : undefined,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`relative rounded-xl overflow-hidden transition-shadow ${
        isDragging ? "ring-2 ring-primary shadow-xl" : ""
      }`}
      {...attributes}
      {...listeners}
    >
      {/* Blurred cover background */}
      {item.coverImageUrl && (
        <div className="absolute inset-0 overflow-hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.coverImageUrl}
            alt=""
            aria-hidden
            className="book-card-bg-img absolute inset-0 h-full w-full scale-150 object-cover"
          />
          <div className="absolute inset-0 currently-reading-overlay" />
        </div>
      )}
      {!item.coverImageUrl && (
        <div className="absolute inset-0 bg-gradient-to-br from-surface-alt to-surface rounded-xl" />
      )}

      {/* Position badge */}
      <span className="absolute top-2 left-2 z-20 flex h-5 w-5 items-center justify-center rounded-full bg-neon-purple text-[10px] font-bold text-white shadow-md">
        {index + 1}
      </span>

      {/* Card content */}
      <Link
        href={`/book/${item.slug || item.bookId}`}
        onClick={(e) => { if (isDragging) e.preventDefault(); }}
        draggable={false}
        className="relative z-10 flex items-center gap-3 p-3"
      >
        {/* Cover */}
        <div className="flex-shrink-0">
          {item.coverImageUrl ? (
            <Image
              src={item.coverImageUrl}
              alt={`Cover of ${item.title}`}
              width={70}
              height={105}
              className="h-[84px] w-[56px] lg:h-[105px] lg:w-[70px] rounded-lg object-cover shadow-xl pointer-events-none"
              draggable={false}
            />
          ) : (
            <NoCover title={item.title} className="h-[84px] w-[56px] lg:h-[105px] lg:w-[70px] shadow-xl pointer-events-none" size="sm" />
          )}
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1 flex flex-col justify-center">
          {item.topLevelGenre && (
            <span className="text-[10px] font-medium uppercase tracking-wider book-header-text-muted leading-none">
              {item.topLevelGenre}
            </span>
          )}
          <h3 className="text-sm font-bold book-header-text leading-tight line-clamp-2 mt-0.5">
            {item.title}
          </h3>
          {item.authorName && (
            <p className="hidden lg:block text-[11px] book-header-text-muted line-clamp-1 mt-0.5">{item.authorName}</p>
          )}

          {/* Meta row: pages · audiobook, rating */}
          <div className="flex items-center gap-1 mt-1 text-[10px] book-header-text-muted">
            {item.pages && <span>{item.pages}p</span>}
            {item.pages && item.audioLengthMinutes && <span>·</span>}
            {item.audioLengthMinutes && (
              <span className="inline-flex items-center gap-0.5">
                🎧 {formatAudioCompact(item.audioLengthMinutes)}
              </span>
            )}
            {item.userRating && (
              <span className="font-medium text-primary ml-auto">
                {formatRating(item.userRating)} ★
              </span>
            )}
          </div>
        </div>
      </Link>
    </div>
  );
}

export function UpNextShelf({ items: initialItems }: { items: UpNextItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [isPending, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">
        No books queued up.{" "}
        <span className="text-foreground/50">Add books to Up Next from any book&apos;s page.</span>
      </p>
    );
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = items.findIndex((i) => i.bookId === active.id);
    const newIndex = items.findIndex((i) => i.bookId === over.id);
    const reordered = arrayMove(items, oldIndex, newIndex).map((item, i) => ({
      ...item,
      position: i + 1,
    }));
    setItems(reordered);

    const movedBookId = active.id as string;
    startTransition(async () => {
      await reorderUpNext(movedBookId, newIndex + 1);
    });
  }

  return (
    <div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={items.map((i) => i.bookId)} strategy={rectSortingStrategy}>
          <div className={`grid grid-cols-2 gap-3 lg:grid-cols-2 lg:gap-3 ${isPending ? "opacity-60" : ""}`}>
            {items.map((item, index) => (
              <SortableUpNextCard key={item.bookId} item={item} index={index} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {items.length > 1 && (
        <p className="text-[10px] text-muted/50 mt-2 text-center">Hold &amp; drag to reorder</p>
      )}
    </div>
  );
}
