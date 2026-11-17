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

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className={`rounded-full px-5 py-1.5 text-[11px] font-semibold transition-all ${
        optimisticFollowing
          ? "border border-accent/60 bg-surface/60 text-foreground backdrop-blur-md"
          : "bg-accent text-black font-bold hover:brightness-110"
      } ${isPending ? "opacity-60" : ""}`}
    >
      {optimisticFollowing ? "Following" : "Follow"}
    </button>
  );
}
