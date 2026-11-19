"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import Image from "next/image";
import { inviteToBuddyRead } from "@/lib/actions/buddy-reads";

interface Member {
  userId: string;
  displayName: string;
  status: string;
}

interface SearchResult {
  id: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
}

interface BuddyReadInviteProps {
  buddyReadId: string;
  inviteCode: string;
  members: Member[];
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function BuddyReadInvite({
  buddyReadId,
  inviteCode,
  members,
}: BuddyReadInviteProps) {
  const [copied, setCopied] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [invitedIds, setInvitedIds] = useState<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const inviteUrl = `https://thebasedreader.app/buddy-reads/join/${inviteCode}`;
  const pendingInvites = members.filter((m) => m.status === "invited");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: do nothing
    }
  }

  // Debounced user search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!query.trim()) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/users/search?q=${encodeURIComponent(query.trim())}`,
        );
        if (res.ok) {
          const data = await res.json();
          setResults(data);
        }
      } catch {
        // Silently fail
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  function handleInvite(userId: string) {
    startTransition(async () => {
      setInvitedIds((prev) => new Set([...prev, userId]));
      await inviteToBuddyRead(buddyReadId, userId);
    });
  }

  // Filter out existing members from search results
  const memberIds = new Set(members.map((m) => m.userId));

  return (
    <div className="flex flex-col gap-5 rounded-[18px] border border-foreground/10 bg-surface/60 p-4 backdrop-blur-md">
      {/* Copy invite link */}
      <div>
        <p className="eyebrow mb-2">Share invite link</p>
        <button
          type="button"
          onClick={handleCopy}
          className="btn-glass w-full cursor-pointer px-4 py-2.5 text-sm"
        >
          {copied ? (
            <>
              <svg
                className="w-4 h-4 text-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M4.5 12.75l6 6 9-13.5"
                />
              </svg>
              <span className="font-semibold">Copied</span>
            </>
          ) : (
            <>
              <svg
                className="w-4 h-4 text-neon-blue"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184"
                />
              </svg>
              <span>Copy invite link</span>
            </>
          )}
        </button>
      </div>

      {/* Search and invite users */}
      <div>
        <p className="eyebrow mb-2">Invite a reader</p>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name or username..."
          className="field-glass w-full text-sm"
        />

        {/* Search results */}
        {(results.length > 0 || searching) && (
          <div className="mt-2 overflow-hidden rounded-[18px] border border-foreground/10 bg-surface/90 backdrop-blur-md">
            {searching && results.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted/60 font-body">
                Searching...
              </p>
            )}
            {results
              .filter((u) => !memberIds.has(u.id))
              .map((user) => {
                const alreadyInvited = invitedIds.has(user.id);

                return (
                  <div
                    key={user.id}
                    className="flex items-center gap-3 px-4 py-2.5 border-b border-foreground/10 last:border-b-0"
                  >
                    {user.avatarUrl ? (
                      <Image
                        src={user.avatarUrl}
                        alt={user.displayName}
                        width={28}
                        height={28}
                        className="w-7 h-7 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded-full border border-foreground/12 bg-surface/80 flex items-center justify-center shrink-0">
                        <span className="text-[9px] font-bold text-foreground">
                          {getInitials(user.displayName)}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-body text-sm text-foreground truncate">
                        {user.displayName}
                      </p>
                      <p className="font-body text-[11px] text-muted/60">
                        @{user.username}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleInvite(user.id)}
                      disabled={isPending || alreadyInvited}
                      data-active={alreadyInvited ? "true" : undefined}
                      className={`btn-glass shrink-0 cursor-pointer gap-1 px-3 py-1 text-[11px] ${isPending ? "opacity-60" : ""}`}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className={alreadyInvited ? "text-accent" : "text-neon-blue"} aria-hidden="true">
                        {alreadyInvited ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M12 5v14M5 12h14" />}
                      </svg>
                      {alreadyInvited ? "Invited" : "Invite"}
                    </button>
                  </div>
                );
              })}
          </div>
        )}
      </div>

      {/* Pending invites */}
      {pendingInvites.length > 0 && (
        <div>
          <p className="eyebrow mb-2">Pending invites</p>
          <div className="flex flex-col gap-2">
            {pendingInvites.map((member) => (
              <div
                key={member.userId}
                className="flex items-center gap-3 rounded-full border border-foreground/10 bg-surface/80 px-3 py-2"
              >
                <div className="w-6 h-6 rounded-full border border-foreground/12 bg-surface flex items-center justify-center shrink-0">
                  <span className="text-[9px] font-bold text-foreground">
                    {getInitials(member.displayName)}
                  </span>
                </div>
                <span className="font-body text-sm text-foreground flex-1 truncate">
                  {member.displayName}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-foreground/10 bg-surface px-2 py-0.5 text-[10px] font-semibold text-foreground">
                  <span className="h-[6px] w-[6px] rounded-full bg-neon-purple" aria-hidden="true" />
                  Pending
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
