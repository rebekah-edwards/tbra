"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { NoCover } from "@/components/no-cover";
import { BuddyReadProgressTracker } from "@/components/buddy-reads/buddy-read-progress-tracker";
import { BuddyReadDiscussion } from "@/components/buddy-reads/buddy-read-discussion";
import { BuddyReadInvite } from "@/components/buddy-reads/buddy-read-invite";
import { completeBuddyRead } from "@/lib/actions/buddy-reads";
import type { BuddyReadDetail, BuddyReadMembership } from "@/lib/queries/buddy-reads";

interface Message {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  message: string;
  createdAt: string;
}

interface BuddyReadDetailClientProps {
  detail: BuddyReadDetail;
  messages: Message[];
  membership: BuddyReadMembership | null;
  isHost: boolean;
  currentUserId: string;
}

export function BuddyReadDetailClient({
  detail,
  messages,
  membership,
  isHost,
  currentUserId,
}: BuddyReadDetailClientProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [showShare, setShowShare] = useState(false);

  const inviteUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/buddy-reads/join/${detail.inviteCode}`
      : "";

  function handleComplete() {
    if (!window.confirm("This will end the buddy read for all members. It does not change anyone's personal reading progress. Continue?")) return;
    startTransition(async () => {
      await completeBuddyRead(detail.id);
      router.refresh();
    });
  }

  async function handleShare() {
    if (navigator.share) {
      try {
        await navigator.share({
          title: detail.name,
          text: `Join my buddy read for "${detail.book.title}" on tbr*a!`,
          url: inviteUrl,
        });
      } catch {
        /* cancelled */
      }
    } else {
      await navigator.clipboard.writeText(inviteUrl);
      setShowShare(true);
      setTimeout(() => setShowShare(false), 2000);
    }
  }

  const statusBadge = detail.status === "completed" ? (
    <span className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
      Completed
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full bg-accent/15 px-2.5 py-0.5 text-xs font-semibold text-accent">
      Active
    </span>
  );

  const host = detail.members.find((m) => m.role === "host");

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6">
      {/* Back link */}
      <Link
        href="/buddy-reads"
        className="inline-flex items-center gap-1 text-sm text-neon-blue hover:underline mb-4"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        All Buddy Reads
      </Link>

      {/* Header */}
      <div className="flex gap-4 mb-6">
        {/* Book cover */}
        <Link
          href={detail.book.slug ? `/book/${detail.book.slug}` : "#"}
          className="flex-shrink-0"
        >
          <div className="h-28 w-20 overflow-hidden rounded-lg shadow-md">
            {detail.book.coverImageUrl ? (
              <Image
                src={detail.book.coverImageUrl}
                alt={detail.book.title}
                width={80}
                height={112}
                className="h-full w-full object-cover"
              />
            ) : (
              <NoCover title={detail.book.title} size="md" />
            )}
          </div>
        </Link>

        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-heading font-bold text-foreground mb-1 truncate">
            {detail.book.title}
          </h1>
          <Link
            href={detail.book.slug ? `/book/${detail.book.slug}` : "#"}
            className="text-sm text-neon-blue hover:underline truncate block"
          >
            View book details
          </Link>
          {detail.book.authors.length > 0 && (
            <p className="text-xs text-muted mt-0.5">
              by {detail.book.authors.join(", ")}
            </p>
          )}
          <div className="flex items-center gap-2 mt-2">
            {statusBadge}
            {host && (
              <span className="text-xs text-muted">
                Hosted by{" "}
                {host.displayName ?? host.username ?? "Reader"}
              </span>
            )}
          </div>
        </div>
      </div>

      {detail.description && (
        <p className="text-sm text-muted mb-6">{detail.description}</p>
      )}

      {/* Host controls */}
      {isHost && detail.status === "active" && (
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={handleComplete}
            disabled={isPending}
            className="rounded-full bg-[#a3e635] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {isPending ? "Ending..." : "End Buddy Read"}
          </button>
          <button
            onClick={handleShare}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-alt"
          >
            {showShare ? "Link Copied!" : "Share Invite"}
          </button>
        </div>
      )}

      {/* Non-host share button */}
      {!isHost && membership && (
        <div className="mb-6">
          <button
            onClick={handleShare}
            className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-surface-alt"
          >
            {showShare ? "Link Copied!" : "Share Invite Link"}
          </button>
        </div>
      )}

      {/* Progress tracker */}
      <section className="mb-8">
        <h2 className="section-heading text-neon-blue text-lg font-heading font-semibold mb-3">
          Progress
        </h2>
        <BuddyReadProgressTracker
          members={detail.members.map((m) => {
            // DB reading state is 'completed' / 'currently_reading' / 'tbr' / 'paused' / 'dnf'.
            // Map to the tracker's simpler three-state model, and auto-force
            // percentComplete to 100 once the book is completed/dnf so a stale
            // reading note at e.g. 90% doesn't keep showing when the book is finished.
            const raw = m.readingState;
            const isFinished = raw === "completed" || raw === "dnf";
            const trackerState: "not_started" | "currently_reading" | "finished" = isFinished
              ? "finished"
              : raw === "currently_reading" || raw === "paused"
                ? "currently_reading"
                : "not_started";
            return {
              userId: m.userId,
              displayName: m.displayName ?? m.username ?? "Reader",
              username: m.username ?? "",
              avatarUrl: m.avatarUrl,
              readingState: trackerState,
              percentComplete: isFinished ? 100 : (m.percentComplete ?? 0),
              completionDate: m.completionDate,
            };
          })}
        />
      </section>

      {/* Discussion */}
      {membership && (
        <section className="mb-8">
          <h2 className="section-heading text-neon-blue text-lg font-heading font-semibold mb-3">
            Discussion
          </h2>
          <BuddyReadDiscussion
            buddyReadId={detail.id}
            messages={messages}
            currentUserId={currentUserId}
          />
        </section>
      )}

      {/* Host invite controls */}
      {isHost && (
        <section className="mb-8">
          <h2 className="section-heading text-neon-blue text-lg font-heading font-semibold mb-3">
            Invite Members
          </h2>
          <BuddyReadInvite
            buddyReadId={detail.id}
            inviteCode={detail.inviteCode}
            members={detail.members.map((m) => ({
              userId: m.userId,
              displayName: m.displayName ?? m.username ?? "Reader",
              status: m.status,
            }))}
          />
        </section>
      )}
    </div>
  );
}
