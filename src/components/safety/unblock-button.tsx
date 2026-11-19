"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unblockUser } from "@/lib/actions/blocks";

/** Shown on a profile the viewer has blocked. */
export function UnblockButton({ targetUserId }: { targetUserId: string }) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await unblockUser(targetUserId);
            if (result.success) router.refresh();
            else setError(result.error ?? "Couldn't unblock this reader.");
          });
        }}
        className="btn-glass px-5 py-2 text-sm disabled:opacity-50"
      >
        {isPending ? "Unblocking…" : "Unblock"}
      </button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
