"use client";

import { useRef, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { StarRow } from "./rounded-star";
import { SpoilerParticles } from "./spoiler-particles";
import { MOODS, DIMENSION_SECTIONS } from "@/lib/review-constants";
import { timeAgo } from "@/lib/date-utils";
import { toggleHelpfulVote } from "@/lib/actions/helpful";
import { formatRating } from "@/lib/text-utils";
import DOMPurify from "isomorphic-dompurify";
import type { BookReviewEntry } from "@/lib/queries/review";

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function ReviewCard({ review, bookId, isOwnReview = false }: { review: BookReviewEntry; bookId: string; isOwnReview?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const textInnerRef = useRef<HTMLDivElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [voted, setVoted] = useState(review.currentUserVoted);
  const [count, setCount] = useState(review.helpfulCount);
  const [isPending, startTransition] = useTransition();
  const [textExpanded, setTextExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);
  const hasSpoilers = review.reviewText?.includes("spoiler-tag") ?? false;

  // Measure if review text exceeds ~8 lines (~176px at 22px line height)
  const TEXT_MAX_HEIGHT = 176;
  useEffect(() => {
    const el = textInnerRef.current;
    if (!el) return;
    if (el.scrollHeight > TEXT_MAX_HEIGHT + 20) {
      setIsTruncated(true);
    }
  }, [review.reviewText]);

  // Spoiler tag reveal on tap
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains("spoiler-tag")) {
        target.classList.toggle("revealed");
      }
    };
    el.addEventListener("click", handler);
    return () => el.removeEventListener("click", handler);
  }, []);

  const mood = MOODS.find((m) => m.key === review.mood);

  // Collect dimensions that have ratings or tags
  const dimensionsWithData = DIMENSION_SECTIONS.filter(
    (d) =>
      review.dimensionRatings[d.key] != null ||
      (review.dimensionTags[d.key] && review.dimensionTags[d.key].length > 0)
  );

  const hasDetails = dimensionsWithData.length > 0;

  return (
    <div
      id={`review-${review.id}`}
      ref={containerRef}
      className="rounded-xl bg-surface-alt border border-border/50 p-4 space-y-3"
    >
      {/* Header: avatar, name, date */}
      <div className="flex items-center gap-3">
        <div className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold overflow-hidden ${
          review.isAnonymous
            ? "bg-muted/20 text-muted"
            : review.avatarUrl
              ? ""
              : "text-black"
        }`} style={!review.isAnonymous && !review.avatarUrl ? { backgroundColor: "#a3e635" } : undefined}>
          {review.isAnonymous ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          ) : review.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={review.avatarUrl} alt="" className="w-full h-full object-cover" />
          ) : (
            getInitials(review.displayName)
          )}
        </div>
        <div className="flex-1 min-w-0">
          {!review.isAnonymous && review.username ? (
            <Link href={`/u/${review.username}`} className="text-sm font-medium truncate text-foreground hover:text-primary transition-colors block">
              {review.displayName ?? "Anonymous"}
            </Link>
          ) : (
            <p className={`text-sm font-medium truncate ${
              review.isAnonymous ? "text-muted italic" : "text-foreground"
            }`}>
              {review.isAnonymous ? "Anonymous" : (review.displayName ?? "Anonymous")}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {review.source && review.source !== "user" && (
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface-alt text-muted border border-border capitalize">
              {review.source}
            </span>
          )}
          <span className="text-xs text-muted">
            {timeAgo(review.createdAt)}
          </span>
        </div>
      </div>

      {/* Centered overall rating — bigger, standout */}
      {(review.overallRating != null || review.didNotFinish || mood) && (
        <div className="flex flex-col items-center gap-1 py-1">
          {/* Stars + numeric + DNF badge */}
          {review.overallRating != null && (
            <div className="flex items-center gap-2">
              <StarRow rating={review.overallRating} size={24} />
              <span className="text-lg font-bold text-foreground">
                {formatRating(review.overallRating)}
              </span>
              {review.didNotFinish && (
                <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
                  DNF{review.dnfPercentComplete != null ? ` ${review.dnfPercentComplete}%` : ""}
                </span>
              )}
            </div>
          )}
          {/* No rating but DNF */}
          {review.overallRating == null && review.didNotFinish && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-destructive/15 text-destructive">
              DNF{review.dnfPercentComplete != null ? ` ${review.dnfPercentComplete}%` : ""}
            </span>
          )}
          {/* Mood on its own line */}
          {mood && (
            <span className="text-sm text-muted">
              {mood.emoji} {mood.label}
            </span>
          )}
        </div>
      )}

      {/* Review text — right after stars/mood */}
      {review.reviewText && (
        <div ref={textRef} className="relative">
          <div
            ref={textInnerRef}
            className="text-sm text-foreground/90 leading-relaxed [&_p]:mb-2.5 [&_p:last-child]:mb-0 [&_b]:font-semibold [&_i]:italic [&_u]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 overflow-hidden transition-[max-height] duration-300"
            style={isTruncated && !textExpanded ? { maxHeight: `${TEXT_MAX_HEIGHT}px` } : undefined}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(review.reviewText, {
              ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'span', 'ul', 'ol', 'li', 'blockquote'],
              ALLOWED_ATTR: ['class', 'data-spoiler'],
              FORBID_ATTR: ['style', 'onclick', 'onerror', 'onload'],
            }) }}
          />
          {isTruncated && !textExpanded && (
            <div className="absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-surface-alt to-transparent pointer-events-none" />
          )}
          {hasSpoilers && <SpoilerParticles containerRef={textRef} />}
        </div>
      )}
      {isTruncated && (
        <button
          type="button"
          onClick={() => setTextExpanded(!textExpanded)}
          className="text-xs text-primary font-medium"
        >
          {textExpanded ? "Show less" : "Show more"}
        </button>
      )}

      {/* Collapsible dimension details */}
      {hasDetails && (
        <>
          {detailsOpen && (
            <div className="space-y-3 pt-1 border-t border-border/30">
              {dimensionsWithData.map((dim) => {
                const rating = review.dimensionRatings[dim.key];
                const tags = review.dimensionTags[dim.key] ?? [];
                return (
                  <div key={dim.key} className="space-y-1.5">
                    {/* Dimension label + stars */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-muted">{dim.label}</span>
                      {rating != null && <StarRow rating={rating} size={14} />}
                    </div>
                    {/* Tags for this dimension */}
                    {tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pl-0.5">
                        {tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs px-2.5 py-1 rounded-full bg-primary/15 text-primary font-medium"
                          >
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => setDetailsOpen(!detailsOpen)}
            className="w-full text-center text-xs text-primary hover:text-primary/80 font-medium pt-1"
          >
            {detailsOpen ? "Hide details" : "See all details"}
          </button>
        </>
      )}

      {/* Action row */}
      <div className="flex items-center justify-between pt-1">
        {isOwnReview ? (
          <Link
            href={`/book/${bookId}`}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full text-primary hover:bg-primary/10 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            Edit
          </Link>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              setVoted(!voted);
              setCount(voted ? count - 1 : count + 1);
              startTransition(async () => {
                const result = await toggleHelpfulVote(review.id, bookId);
                if (result.error) {
                  setVoted(voted);
                  setCount(count);
                }
              });
            }}
            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full transition-colors ${
              voted
                ? "bg-purple-500/15 text-purple-400"
                : "text-muted hover:text-foreground hover:bg-surface-alt"
            }`}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill={voted ? "currentColor" : "none"}
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3m7-2V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3H14z" />
            </svg>
            {count > 0 ? count : "Helpful"}
          </button>
        )}

        <button
          type="button"
          onClick={async () => {
            const url = `${window.location.origin}/book/${bookId}/reviews`;
            if (navigator.share) {
              try {
                await navigator.share({
                  title: `Review by ${review.displayName ?? "Anonymous"}`,
                  url,
                });
              } catch {
                // User cancelled share
              }
            } else {
              await navigator.clipboard.writeText(url);
            }
          }}
          className="flex items-center gap-1 text-xs text-muted hover:text-foreground px-2 py-1 rounded-full hover:bg-surface-alt transition-colors"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
      </div>
    </div>
  );
}
