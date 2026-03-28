"use client";

import { useState, useTransition } from "react";
import { toggleFollowShelf } from "@/lib/actions/shelves";

interface FollowShelfButtonProps {
  shelfId: string;
  initialFollowing: boolean;
  followerCount: number;
}

export function FollowShelfButton({ shelfId, initialFollowing, followerCount }: FollowShelfButtonProps) {
  const [isFollowing, setIsFollowing] = useState(initialFollowing);
  const [count, setCount] = useState(followerCount);
  const [pending, startTransition] = useTransition();

  function handleToggle() {
    // Optimistic update
    setIsFollowing((prev) => !prev);
    setCount((prev) => isFollowing ? prev - 1 : prev + 1);

    startTransition(async () => {
      const result = await toggleFollowShelf(shelfId);
      if (!result.success) {
        // Revert on failure
        setIsFollowing((prev) => !prev);
        setCount((prev) => isFollowing ? prev + 1 : prev - 1);
      }
    });
  }

  return (
    <button
      onClick={handleToggle}
      disabled={pending}
      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
        isFollowing
          ? "bg-accent/15 border border-accent/30 text-accent"
          : "bg-surface-alt border border-border text-muted hover:text-foreground hover:border-border/80"
      }`}
    >
      {isFollowing ? (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
          Following
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Follow
        </>
      )}
      {count > 0 && (
        <span className={`text-[10px] ${isFollowing ? "text-accent/60" : "text-muted/50"}`}>
          {count}
        </span>
      )}
    </button>
  );
}
