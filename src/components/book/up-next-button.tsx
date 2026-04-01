"use client";

import { useState, useTransition } from "react";
import { addToUpNext, removeFromUpNext } from "@/lib/actions/up-next";

const MAX_UP_NEXT = 6;

interface UpNextButtonProps {
  bookId: string;
  position: number | null; // null = not in queue
  queueCount: number; // how many items currently in queue
  onPositionChange?: (position: number | null) => void;
}

export function UpNextButton({
  bookId,
  position: initialPosition,
  queueCount: initialCount,
  onPositionChange,
}: UpNextButtonProps) {
  const [position, setPosition] = useState(initialPosition);
  const [count, setCount] = useState(initialCount);
  const [isPending, startTransition] = useTransition();

  const isInQueue = position !== null;

  function handleClick() {
    startTransition(async () => {
      if (isInQueue) {
        await removeFromUpNext(bookId);
        setPosition(null);
        setCount((c) => Math.max(0, c - 1));
        onPositionChange?.(null);
      } else {
        if (count >= MAX_UP_NEXT) return; // Queue is full
        const result = await addToUpNext(bookId);
        if (result.success && result.position) {
          setPosition(result.position);
          setCount((c) => c + 1);
          onPositionChange?.(result.position);
        }
      }
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending || (!isInQueue && count >= MAX_UP_NEXT)}
      title={
        isInQueue
          ? `Up Next #${position} — tap to remove`
          : count >= MAX_UP_NEXT
            ? `Up Next is full (${MAX_UP_NEXT} max)`
            : "Add to Up Next"
      }
      className={`
        relative flex items-center justify-center gap-1.5
        rounded-xl px-4 py-2.5
        text-sm font-semibold
        transition-all
        ${isPending ? "opacity-50" : ""}
        ${isInQueue
          ? "bg-muted/15 text-foreground border-2 border-muted/50"
          : "bg-surface-alt text-muted border-2 border-border hover:border-muted/50 hover:text-foreground"
        }
        ${!isInQueue && count >= MAX_UP_NEXT ? "opacity-40 cursor-not-allowed" : "cursor-pointer"}
      `}
    >
      {isPending ? (
        <div className="w-4 h-4 border-2 border-muted/30 border-t-foreground rounded-full animate-spin" />
      ) : isInQueue ? (
        <>
          <span className="text-xs font-bold bg-muted/20 rounded-full w-5 h-5 flex items-center justify-center">{position}</span>
          <span>Up Next</span>
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          <span>Up Next</span>
        </>
      )}
    </button>
  );
}
