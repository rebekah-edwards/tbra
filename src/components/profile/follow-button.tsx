"use client";

import { useOptimistic, useTransition } from "react";
import { followUser, unfollowUser } from "@/lib/actions/follows";

interface FollowButtonProps {
  targetUserId: string;
  initialIsFollowing: boolean;
  /** "lg" is the profile hero; the default is the compact list-row size. */
  size?: "sm" | "lg";
  /** "quiet" keeps Follow in glass (lime + icon) — for lists, where a column of
   *  solid lime pills would break the one-lime-per-screen rule. */
  tone?: "primary" | "quiet";
}

export function FollowButton({ targetUserId, initialIsFollowing, size = "sm", tone = "primary" }: FollowButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [optimisticFollowing, setOptimisticFollowing] = useOptimistic(initialIsFollowing);

  function handleClick() {
    startTransition(async () => {
      setOptimisticFollowing(!optimisticFollowing);
      if (optimisticFollowing) {
        await unfollowUser(targetUserId);
      } else {
        await followUser(targetUserId);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      data-active={optimisticFollowing ? "true" : undefined}
      className={`${
        optimisticFollowing || tone === "quiet" ? "btn-glass" : "btn-lime"
      } ${size === "lg" ? "gap-1.5 px-6 py-2 text-sm" : "gap-1 px-5 py-1.5 text-[11px]"} cursor-pointer ${isPending ? "opacity-60" : ""}`}
    >
      {optimisticFollowing && (
        <svg width={size === "lg" ? 14 : 11} height={size === "lg" ? 14 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      )}
      {!optimisticFollowing && tone === "quiet" && (
        <svg width={size === "lg" ? 14 : 11} height={size === "lg" ? 14 : 11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true" className="text-accent">
          <path d="M12 5v14M5 12h14" />
        </svg>
      )}
      {optimisticFollowing ? "Following" : "Follow"}
    </button>
  );
}
