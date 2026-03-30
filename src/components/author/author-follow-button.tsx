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
          ? "bg-accent text-black"
          : "border border-accent text-accent hover:bg-accent/10"
      } ${isPending ? "opacity-60" : ""}`}
    >
      {optimisticFollowing ? "Following" : "Follow"}
    </button>
  );
}
