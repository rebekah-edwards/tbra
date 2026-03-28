"use client";

import { useState, useRef, useMemo, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
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
  // Round to one decimal for compact display (e.g. "35.5h")
  const rounded = Math.round(totalHours * 10) / 10;
  return `${rounded}h`;
}

// Card dimensions for drag calculations
const CARD_GAP = 12; // gap-3

export function UpNextShelf({ items: initialItems }: { items: UpNextItem[] }) {
  const [items, setItems] = useState(initialItems);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [overIndex, setOverIndex] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const isDragging = useRef(false);
  const didDrag = useRef(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  // Preview position numbers
  const previewPositions = useMemo(() => {
    if (draggingIndex === null || overIndex === null || draggingIndex === overIndex) {
      return items.map((_, i) => i + 1);
    }
    const order = items.map((_, i) => i);
    const [moved] = order.splice(draggingIndex, 1);
    order.splice(overIndex, 0, moved);
    const positions = new Array(items.length).fill(0);
    for (let slot = 0; slot < order.length; slot++) {
      positions[order[slot]] = slot + 1;
    }
    return positions;
  }, [items, draggingIndex, overIndex]);

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted">
        No books queued up.{" "}
        <span className="text-foreground/50">Add books to Up Next from any book&apos;s page.</span>
      </p>
    );
  }

  function commitReorder(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const newItems = [...items];
    const [moved] = newItems.splice(fromIndex, 1);
    newItems.splice(toIndex, 0, moved);
    const updated = newItems.map((item, i) => ({ ...item, position: i + 1 }));
    setItems(updated);

    startTransition(async () => {
      await reorderUpNext(moved.bookId, toIndex + 1);
    });
  }

  function handlePointerDown(e: React.PointerEvent, index: number) {
    dragStartPos.current = { x: e.clientX, y: e.clientY };

    longPressTimer.current = setTimeout(() => {
      isDragging.current = true;
      setDraggingIndex(index);
      setOverIndex(index);
      document.body.style.userSelect = "none";
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    }, 300);
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!dragStartPos.current) return;

    if (!isDragging.current && longPressTimer.current) {
      const dx = Math.abs(e.clientX - dragStartPos.current.x);
      const dy = Math.abs(e.clientY - dragStartPos.current.y);
      if (dx > 10 || dy > 10) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
        dragStartPos.current = null;
      }
      return;
    }

    if (!isDragging.current) return;

    const target = e.target as HTMLElement;
    if (target.hasPointerCapture?.(e.pointerId)) {
      target.releasePointerCapture(e.pointerId);
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (target.setPointerCapture) {
      target.setPointerCapture(e.pointerId);
    }

    if (el) {
      const itemEl = el.closest("[data-drag-index]");
      if (itemEl) {
        const idx = Number(itemEl.getAttribute("data-drag-index"));
        if (!isNaN(idx)) setOverIndex(idx);
      }
    }
  }

  function handlePointerUp() {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    if (isDragging.current && draggingIndex !== null && overIndex !== null) {
      commitReorder(draggingIndex, overIndex);
    }

    if (isDragging.current) {
      didDrag.current = true;
      requestAnimationFrame(() => { didDrag.current = false; });
    }
    isDragging.current = false;
    setDraggingIndex(null);
    setOverIndex(null);
    dragStartPos.current = null;
    document.body.style.userSelect = "";
  }

  return (
    <div
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className="touch-none"
    >
      <div
        ref={gridRef}
        className={`grid grid-cols-2 gap-3 lg:grid-cols-2 lg:gap-3 ${isPending ? "opacity-60" : ""}`}
      >
        {items.map((item, index) => {
          const isBeingDragged = draggingIndex === index;
          const isDropTarget = draggingIndex !== null && overIndex === index && !isBeingDragged;

          return (
            <div
              key={item.bookId}
              data-drag-index={index}
              style={draggingIndex !== null ? { order: previewPositions[index] } : undefined}
              className={`relative rounded-xl overflow-hidden transition-all duration-200 ${
                isBeingDragged ? "opacity-50 scale-95 ring-2 ring-primary" : ""
              } ${isDropTarget ? "scale-[1.03] ring-2 ring-primary/50" : ""}`}
              onPointerDown={(e) => handlePointerDown(e, index)}
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
                {previewPositions[index]}
              </span>

              {/* Card content */}
              <Link
                href={`/book/${item.slug || item.bookId}`}
                onClick={(e) => { if (isDragging.current || didDrag.current) e.preventDefault(); }}
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

                  {/* Meta row: pages · 🎧 Xh, rating */}
                  <div className="flex items-center gap-1 mt-1 text-[10px] book-header-text-muted">
                    {item.pages && (
                      <span>{item.pages}p</span>
                    )}
                    {item.pages && item.audioLengthMinutes && (
                      <span>·</span>
                    )}
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
        })}
      </div>
      {items.length > 1 && (
        <p className="text-[10px] text-muted/50 mt-2 text-center">Long press &amp; drag to reorder</p>
      )}
    </div>
  );
}
