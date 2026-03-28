"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateUserAccountType } from "@/lib/actions/admin-users";
import { syncUsersFromLive } from "@/lib/actions/admin-sync";
import { AccountBadge } from "@/components/profile/account-badge";

interface UserRow {
  id: string;
  email: string;
  displayName: string | null;
  username: string | null;
  accountType: string;
  createdAt: string;
}

const ACCOUNT_TYPE_OPTIONS = [
  { value: "reader", label: "Reader" },
  { value: "premium", label: "Based Reader (Premium)" },
  { value: "beta_tester", label: "Beta Tester" },
  { value: "admin", label: "Admin" },
  { value: "super_admin", label: "Super Admin" },
];

export function UserManagement({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [localUsers, setLocalUsers] = useState(users);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{
    id: string;
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{
    text: string;
    type: "success" | "error";
  } | null>(null);

  const filtered = search
    ? localUsers.filter(
        (u) =>
          u.email.toLowerCase().includes(search.toLowerCase()) ||
          u.displayName?.toLowerCase().includes(search.toLowerCase()) ||
          u.username?.toLowerCase().includes(search.toLowerCase())
      )
    : localUsers;

  function handleTypeChange(userId: string, newType: string) {
    if (userId === currentUserId) {
      setFeedback({
        id: userId,
        message: "Cannot change your own account type",
        type: "error",
      });
      return;
    }

    setPendingId(userId);
    startTransition(async () => {
      const result = await updateUserAccountType(userId, newType);
      if (result.success) {
        setLocalUsers((prev) =>
          prev.map((u) =>
            u.id === userId ? { ...u, accountType: newType } : u
          )
        );
        setFeedback({ id: userId, message: "Updated", type: "success" });
      } else {
        setFeedback({
          id: userId,
          message: result.error ?? "Failed",
          type: "error",
        });
      }
      setPendingId(null);
      setTimeout(() => setFeedback(null), 3000);
    });
  }

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await syncUsersFromLive();
      setSyncMessage({
        text: result.message,
        type: result.success ? "success" : "error",
      });
      if (result.success) {
        router.refresh();
      }
    } catch {
      setSyncMessage({ text: "Sync failed", type: "error" });
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMessage(null), 5000);
    }
  }

  return (
    <div className="space-y-4">
      {/* Sync from live */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSync}
          disabled={syncing}
          className="rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {syncing ? "Syncing..." : "Sync Users from Live"}
        </button>
        {syncMessage && (
          <span
            className={`text-xs font-medium ${
              syncMessage.type === "success"
                ? "text-accent"
                : "text-destructive"
            }`}
          >
            {syncMessage.text}
          </span>
        )}
      </div>

      {/* Search */}
      <input
        type="text"
        placeholder="Search users..."
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
      />

      {/* Count */}
      <p className="text-xs text-muted">
        {filtered.length} user{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* User list */}
      <div className="space-y-2">
        {filtered.map((user) => {
          const isSelf = user.id === currentUserId;
          const memberSince = new Date(user.createdAt).toLocaleDateString(
            "en-US",
            { month: "short", year: "numeric" }
          );

          return (
            <div
              key={user.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  {user.username ? (
                    <Link href={`/u/${user.username}`} className="text-sm font-medium text-foreground truncate hover:text-primary transition-colors">
                      {user.displayName || user.email.split("@")[0]}
                    </Link>
                  ) : (
                    <p className="text-sm font-medium text-foreground truncate">
                      {user.displayName || user.email.split("@")[0]}
                    </p>
                  )}
                  <AccountBadge accountType={user.accountType} />
                  {isSelf && (
                    <span className="text-[10px] text-muted">(you)</span>
                  )}
                </div>
                <p className="text-xs text-muted truncate">{user.email}</p>
                {user.username && (
                  <Link href={`/u/${user.username}`} className="text-xs text-muted/70 hover:text-primary transition-colors">
                    @{user.username}
                  </Link>
                )}
                <p className="text-[10px] text-muted/50 mt-0.5">
                  Joined {memberSince}
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={user.accountType}
                  onChange={(e) => handleTypeChange(user.id, e.target.value)}
                  disabled={isSelf || (isPending && pendingId === user.id)}
                  className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {ACCOUNT_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>

                {feedback?.id === user.id && (
                  <span
                    className={`text-[10px] font-medium ${
                      feedback.type === "success"
                        ? "text-accent"
                        : "text-destructive"
                    }`}
                  >
                    {feedback.message}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
