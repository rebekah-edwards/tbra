"use client";

import { useOptimistic, useTransition } from "react";
import { followAuthor, unfollowAuthor } from "@/lib/actions/author-follows";

interface AuthorFollowButtonProps {
  authorId: string;
  initialIsFollowing: boolean;
}

export function AuthorFollowButton({ authorId, initialIsFollowing }: AuthorFollowButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticFollowing, setOptimisticFollowing] = useOptimistic(initialIsFollowing);

  function handleClick() {
    startTransition(async () => {
      setOptimisticFollowing(!optimisticFollowing);
      if (optimisticFollowing) {
        await unfollowAuthor(authorId);
      } else {
        await followAuthor(authorId);
      }
    });
  }

  // Same control as the profile Follow button (design refresh): solid lime
  // pill to follow, neutral glass with a lime check once following.
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      data-active={optimisticFollowing ? "true" : undefined}
      aria-pressed={optimisticFollowing}
      className={`${optimisticFollowing ? "btn-glass" : "btn-lime"} gap-1.5 px-6 py-2 text-sm cursor-pointer ${isPending ? "opacity-60" : ""}`}
    >
      {optimisticFollowing && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
      {optimisticFollowing ? "Following" : "Follow"}
    </button>
  );
}
