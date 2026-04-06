"use client";

import { useOptimistic, useTransition } from "react";
import { joinBuddyRead, leaveBuddyRead } from "@/lib/actions/buddy-reads";

interface JoinBuddyReadButtonProps {
  buddyReadId: string;
  initialIsMember: boolean;
  initialStatus: string | null;
}

type OptimisticState = {
  isMember: boolean;
  status: string | null;
};

export function JoinBuddyReadButton({
  buddyReadId,
  initialIsMember,
  initialStatus,
}: JoinBuddyReadButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useOptimistic<OptimisticState>(
    { isMember: initialIsMember, status: initialStatus },
  );

  function handleJoin() {
    startTransition(async () => {
      setOptimistic({ isMember: true, status: "active" });
      await joinBuddyRead(buddyReadId);
    });
  }

  function handleLeave() {
    startTransition(async () => {
      setOptimistic({ isMember: false, status: null });
      await leaveBuddyRead(buddyReadId);
    });
  }

  function handleAccept() {
    startTransition(async () => {
      setOptimistic({ isMember: true, status: "active" });
      await joinBuddyRead(buddyReadId);
    });
  }

  function handleDecline() {
    startTransition(async () => {
      setOptimistic({ isMember: false, status: null });
      await leaveBuddyRead(buddyReadId);
    });
  }

  // Invited state: show Accept / Decline
  if (optimistic.status === "invited") {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleAccept}
          disabled={isPending}
          className={`rounded-full bg-accent px-5 py-1.5 text-[11px] font-semibold text-black transition-all ${
            isPending ? "opacity-60" : ""
          }`}
        >
          Accept
        </button>
        <button
          type="button"
          onClick={handleDecline}
          disabled={isPending}
          className={`rounded-full border border-border px-5 py-1.5 text-[11px] font-semibold text-muted transition-all hover:bg-surface-hover ${
            isPending ? "opacity-60" : ""
          }`}
        >
          Decline
        </button>
      </div>
    );
  }

  // Joined state: outlined with checkmark
  if (optimistic.isMember) {
    return (
      <button
        type="button"
        onClick={handleLeave}
        disabled={isPending}
        className={`flex items-center gap-1.5 rounded-full border border-accent px-5 py-1.5 text-[11px] font-semibold text-accent transition-all hover:bg-accent/10 ${
          isPending ? "opacity-60" : ""
        }`}
      >
        <svg
          className="w-3 h-3"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 12.75l6 6 9-13.5"
          />
        </svg>
        Joined
      </button>
    );
  }

  // Default: Join button
  return (
    <button
      type="button"
      onClick={handleJoin}
      disabled={isPending}
      className={`rounded-full bg-accent px-5 py-1.5 text-[11px] font-semibold text-black transition-all ${
        isPending ? "opacity-60" : ""
      }`}
    >
      Join
    </button>
  );
}
