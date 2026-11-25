"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { NoCover } from "@/components/no-cover";
import { BuddyReadProgressTracker } from "@/components/buddy-reads/buddy-read-progress-tracker";
import { BuddyReadDiscussion } from "@/components/buddy-reads/buddy-read-discussion";
import { BuddyReadInvite } from "@/components/buddy-reads/buddy-read-invite";
import { completeBuddyRead, cancelBuddyRead, reopenBuddyRead, leaveBuddyRead } from "@/lib/actions/buddy-reads";
import type { BuddyReadDetail, BuddyReadMembership } from "@/lib/queries/buddy-reads";
import { AuthorLinks } from "@/components/book/author-links";

interface Message {
  id: string;
  userId: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  message: string;
  kind?: string;
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

  const [error, setError] = useState<string | null>(null);

  function runLifecycle(action: (id: string) => Promise<{ success: boolean; error?: string }>, after?: () => void) {
    setError(null);
    startTransition(async () => {
      const res = await action(detail.id);
      if (!res.success) {
        setError(res.error ?? "Something went wrong");
        return;
      }
      if (after) after();
      else router.refresh();
    });
  }

  function handleComplete() {
    if (!window.confirm("Mark this buddy read as finished for everyone? The discussion stays readable. It doesn't change anyone's own reading progress.")) return;
    runLifecycle(completeBuddyRead);
  }

  function handleLeave() {
    if (!window.confirm("Leave this buddy read? You can rejoin later with the invite link.")) return;
    runLifecycle(leaveBuddyRead, () => router.push("/buddy-reads"));
  }

  function handleReopen() {
    runLifecycle(reopenBuddyRead);
  }

  function handleCancel() {
    if (!window.confirm("Cancel this buddy read? It disappears from everyone's buddy reads. This can't be undone.")) return;
    runLifecycle(cancelBuddyRead, () => router.push("/buddy-reads"));
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

  const host = detail.members.find((m) => m.role === "host");
  const bookHref = detail.book.slug ? `/book/${detail.book.slug}` : "#";
  const readerCount = detail.members.filter((m) => m.status === "active").length;

  const shareIcon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
      <polyline points="16 6 12 2 8 6" />
      <line x1="12" y1="2" x2="12" y2="15" />
    </svg>
  );

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

      {/* Hero — designed, not just matched (2026-11 refresh): the buddy read
          sits on its book's blurred cover art inside the wordmark hairline,
          the cover tipped as if just pulled off the shelf, and the details
          centred as one group. Same recipe as Pick From Your Shelf. */}
      <div
        className="mb-7 rounded-[22px] p-px"
        style={{
          background:
            "linear-gradient(135deg, rgba(163,230,53,0.55), rgba(56,189,248,0.35), rgba(192,132,252,0.45))",
        }}
      >
        <div className="relative overflow-hidden rounded-[21px] bg-surface">
          {detail.book.coverImageUrl && (
            <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
              <Image
                src={detail.book.coverImageUrl}
                alt=""
                fill
                sizes="(max-width: 672px) 100vw, 672px"
                className="book-card-bg-img scale-150 object-cover"
              />
              <div className="absolute inset-0 currently-reading-overlay" />
            </div>
          )}

          <div className="relative flex items-center justify-center gap-5 p-5 lg:p-6">
            <Link href={bookHref} className="flex-shrink-0 -rotate-3 transition-transform duration-200 hover:rotate-0">
              <div className="h-[138px] w-[92px] overflow-hidden rounded-lg shadow-[0_10px_24px_rgba(0,0,0,0.45)] ring-1 ring-white/10 lg:h-[156px] lg:w-[104px]">
                {detail.book.coverImageUrl ? (
                  <Image
                    src={detail.book.coverImageUrl}
                    alt={`Cover of ${detail.book.title}`}
                    width={104}
                    height={156}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <NoCover title={detail.book.title} className="h-full w-full" size="md" />
                )}
              </div>
            </Link>

            <div className="min-w-0">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-surface/80 px-2.5 py-1 text-[11px] font-semibold text-foreground backdrop-blur-md">
                <span
                  className={`h-[7px] w-[7px] rounded-full ${
                    detail.status === "completed" ? "bg-neon-blue" : detail.status === "archived" ? "bg-muted" : "bg-accent"
                  }`}
                  aria-hidden="true"
                />
                {detail.status === "completed"
                  ? "Finished buddy read"
                  : detail.status === "archived"
                    ? "Cancelled buddy read"
                    : "Active buddy read"}
              </span>
              <Link href={bookHref} className="block">
                <h1 className="mt-2 font-heading text-[21px] font-bold leading-tight book-header-text line-clamp-3">
                  {detail.book.title}
                </h1>
              </Link>
              {detail.book.authors.length > 0 && (
                <p className="mt-0.5 text-sm book-header-text-sub line-clamp-1">
                  <AuthorLinks authors={detail.book.authors} />
                </p>
              )}
              <p className="mt-1.5 text-xs book-header-text-sub">
                {host && <>Hosted by {host.displayName ?? host.username ?? "Reader"} · </>}
                {readerCount} {readerCount === 1 ? "reader" : "readers"}
              </p>

              {(membership || isHost) && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {detail.status === "active" && (
                  <button
                    onClick={handleShare}
                    className="btn-glass cursor-pointer px-3.5 py-1.5 text-xs"
                  >
                    {shareIcon}
                    {showShare ? "Link copied" : "Share invite"}
                  </button>
                  )}
                  {isHost && detail.status === "active" && (
                    <button
                      onClick={handleComplete}
                      disabled={isPending}
                      className="btn-glass cursor-pointer px-3.5 py-1.5 text-xs disabled:opacity-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                      {isPending ? "Saving…" : "Mark as finished"}
                    </button>
                  )}
                  {isHost && detail.status === "completed" && (
                    <button
                      onClick={handleReopen}
                      disabled={isPending}
                      className="btn-glass cursor-pointer px-3.5 py-1.5 text-xs disabled:opacity-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
                        <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                      Reopen
                    </button>
                  )}
                  {!isHost && membership?.status === "active" && (
                    <button
                      onClick={handleLeave}
                      disabled={isPending}
                      className="btn-glass cursor-pointer px-3.5 py-1.5 text-xs disabled:opacity-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden="true">
                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                        <polyline points="16 17 21 12 16 7" />
                        <line x1="21" y1="12" x2="9" y2="12" />
                      </svg>
                      Leave
                    </button>
                  )}
                  {isHost && detail.status !== "archived" && (
                    <button
                      onClick={handleCancel}
                      disabled={isPending}
                      style={{ ["--ring" as string]: "#f87171" }}
                      className="btn-glass cursor-pointer px-3.5 py-1.5 text-xs disabled:opacity-50"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M15 9l-6 6M9 9l6 6" />
                      </svg>
                      Cancel buddy read
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <p className="mb-4 rounded-2xl border border-red-400/30 bg-surface/70 px-4 py-2.5 text-sm text-foreground">{error}</p>
      )}

      {detail.description && (
        <div className="mb-7 rounded-[18px] border border-foreground/10 bg-surface/60 p-4 backdrop-blur-md">
          <p className="eyebrow mb-1.5">About this buddy read</p>
          <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-line">{detail.description}</p>
        </div>
      )}

      {/* Progress tracker */}
      <section className="mb-7">
        <h2 className="section-heading text-sm mb-3">
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
        <section className="mb-7">
          <h2 className="section-heading text-sm mb-3">
            Discussion
          </h2>
          <BuddyReadDiscussion
            buddyReadId={detail.id}
            messages={messages}
            currentUserId={currentUserId}
            readOnly={detail.status !== "active"}
          />
        </section>
      )}

      {/* Host invite controls */}
      {isHost && detail.status === "active" && (
        <section className="mb-7">
          <h2 className="section-heading text-sm mb-3">
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
