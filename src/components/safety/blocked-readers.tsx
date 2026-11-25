"use client";

import { useState, useTransition } from "react";
import { unblockUser } from "@/lib/actions/blocks";
import type { BlockedUser } from "@/lib/queries/blocks";

/** Settings → Blocked readers. Unblocking does not restore old follows. */
export function BlockedReaders({ initial }: { initial: BlockedUser[] }) {
  const [blocked, setBlocked] = useState(initial);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (blocked.length === 0) {
    return <p className="text-sm text-muted">You haven&rsquo;t blocked anyone.</p>;
  }

  function unblock(id: string) {
    setBusyId(id);
    setError(null);
    startTransition(async () => {
      const result = await unblockUser(id);
      if (result.success) setBlocked((list) => list.filter((u) => u.id !== id));
      else setError(result.error ?? "Couldn't unblock this reader.");
      setBusyId(null);
    });
  }

  return (
    <div className="space-y-2">
      {blocked.map((u) => (
        <div key={u.id} className="row-glass flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-foreground">{u.displayName || (u.username ? `@${u.username}` : "Reader")}</p>
            {u.username && u.displayName && <p className="truncate text-xs text-muted">@{u.username}</p>}
          </div>
          <button
            type="button"
            onClick={() => unblock(u.id)}
            disabled={busyId === u.id}
            className="btn-glass flex-shrink-0 px-3.5 py-1.5 text-sm disabled:opacity-50"
          >
            {busyId === u.id ? "Unblocking…" : "Unblock"}
          </button>
        </div>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
