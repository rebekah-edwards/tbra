"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { submitCorrection } from "@/lib/actions/corrections";
import { verifyContentRatings, adminUpdateRating } from "@/lib/actions/content-verify";

interface Rating {
  categoryKey: string;
  categoryName: string;
  intensity: number;
  notes: string | null;
  evidenceLevel: string;
}

interface ContentProfileProps {
  ratings: Rating[];
  bookId?: string;
  isLoggedIn?: boolean;
  isAdmin?: boolean;
}

// Display order for categories
const CATEGORY_ORDER = [
  "sexual_content",
  "violence_gore",
  "profanity_language",
  "substance_use",
  "lgbtqia_representation",
  "religious_content",
  "witchcraft_occult",
  "political_ideological",
  "self_harm_suicide",
  "sexual_assault_coercion",
  "abuse_suffering",
  "user_added",
];

// Short display names for mobile-friendly single-line rendering
const SHORT_NAMES: Record<string, string> = {
  "lgbtqia_representation": "LGBTQ+ Rep.",
  "profanity_language": "Profanity",
  "political_ideological": "Political content",
  "sexual_assault_coercion": "Sexual assault",
  "abuse_suffering": "Abuse & suffering",
};

const intensityColors = [
  "bg-intensity-0",
  "bg-intensity-1",
  "bg-intensity-2",
  "bg-intensity-3",
  "bg-intensity-4",
];

const evidenceBadge: Record<string, { label: string; className: string }> = {
  ai_inferred: {
    label: "AI",
    className: "bg-surface-alt text-muted",
  },
  cited: {
    label: "AI",
    className: "bg-surface-alt text-muted",
  },
  human_verified: {
    label: "Verified",
    className: "verified-badge",
  },
};

function ExpandableNote({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [clamped, setClamped] = useState(false);
  const textRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const el = textRef.current;
    if (el) {
      // Check if text overflows 5 lines
      setClamped(el.scrollHeight > el.clientHeight);
    }
  }, [text]);

  return (
    <div className="mt-1">
      <p
        ref={textRef}
        className={`text-xs text-muted ${!expanded ? "line-clamp-3" : ""}`}
      >
        {text}
      </p>
      {clamped && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs font-semibold read-more-link"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

function CorrectionModal({
  rating,
  bookId,
  onClose,
}: {
  rating: Rating;
  bookId: string;
  onClose: () => void;
}) {
  const [proposedIntensity, setProposedIntensity] = useState<number | null>(null);
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayName = SHORT_NAMES[rating.categoryKey] ?? rating.categoryName;

  function handleSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await submitCorrection(
        bookId,
        rating.categoryKey,
        proposedIntensity,
        message
      );
      if (result.success) {
        setSubmitted(true);
        setTimeout(onClose, 1500);
      } else {
        setError(result.error ?? "Something went wrong");
      }
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-surface border border-border p-6 pb-8 animate-in slide-in-from-bottom-4">
        {submitted ? (
          <div className="text-center py-6">
            <div className="text-3xl mb-3">&#10003;</div>
            <p className="text-sm font-medium text-primary">Thanks for the report!</p>
            <p className="text-xs text-muted mt-1">We&apos;ll review it shortly.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">Report: {displayName}</h3>
              <button onClick={onClose} className="text-muted hover:text-foreground p-1">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <p className="text-xs text-muted mb-4">
              Current rating: <strong>{rating.intensity}/4</strong>
              {rating.notes && <> &mdash; {rating.notes}</>}
            </p>

            {/* Proposed intensity */}
            <label className="text-xs font-medium text-muted block mb-2">
              What should the rating be?
            </label>
            <div className="flex gap-2 mb-4">
              {[0, 1, 2, 3, 4].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setProposedIntensity(level === proposedIntensity ? null : level)}
                  className={`flex-1 rounded-lg py-2 text-xs font-medium border-2 transition-all ${
                    proposedIntensity === level
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-surface-alt text-muted hover:border-primary/30"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>

            {/* Message */}
            <label className="text-xs font-medium text-muted block mb-2">
              What&apos;s wrong? <span className="text-destructive">*</span>
            </label>
            <textarea
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe the issue — e.g., 'This book has a graphic torture scene in chapter 12 that should be rated higher'"
              maxLength={500}
              className="w-full rounded-xl border-2 border-border bg-surface-alt/30 px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none transition-colors resize-none"
            />
            <div className="flex justify-between mt-1 px-1">
              {error ? (
                <p className="text-xs text-destructive">{error}</p>
              ) : (
                <div />
              )}
              <p className="text-xs text-muted">{message.length}/500</p>
            </div>

            <button
              onClick={handleSubmit}
              disabled={isPending || message.trim().length < 10}
              className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-background shadow-[0_0_20px_rgba(163,230,53,0.25)] hover:shadow-[0_0_28px_rgba(163,230,53,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isPending ? "Submitting..." : "Submit Report"}
            </button>
          </>
        )}
      </div>
    </div>,
    document.body
  );
}

function AdminEditModal({
  rating,
  bookId,
  onClose,
  onSaved,
}: {
  rating: Rating;
  bookId: string;
  onClose: () => void;
  onSaved: (intensity: number, notes: string | null) => void;
}) {
  const [intensity, setIntensity] = useState(rating.intensity);
  const [notes, setNotes] = useState(rating.notes ?? "");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const displayName = SHORT_NAMES[rating.categoryKey] ?? rating.categoryName;

  function handleSave() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await adminUpdateRating(
          bookId,
          rating.categoryKey,
          intensity,
          notes || null
        );
        if (result.success) {
          onSaved(intensity, notes || null);
          onClose();
        } else {
          setError(result.error ?? "Something went wrong");
        }
      } catch (err) {
        console.error("[AdminEditModal] Save failed:", err);
        setError("Save failed — check console for details");
      }
    });
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-t-2xl sm:rounded-2xl bg-surface border border-border p-6 pb-8 animate-in slide-in-from-bottom-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold">Edit: {displayName}</h3>
          <button onClick={onClose} className="text-muted hover:text-foreground p-1">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <label className="text-xs font-medium text-muted block mb-2">
          Intensity
        </label>
        <div className="flex gap-2 mb-4">
          {[0, 1, 2, 3, 4].map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setIntensity(level)}
              className={`flex-1 rounded-lg py-2 text-xs font-medium border-2 transition-all ${
                intensity === level
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-surface-alt text-muted hover:border-primary/30"
              }`}
            >
              {level}
            </button>
          ))}
        </div>

        <label className="text-xs font-medium text-muted block mb-2">
          Notes
        </label>
        <textarea
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Content description for this category"
          maxLength={500}
          className="w-full rounded-xl border-2 border-border bg-surface-alt/30 px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none transition-colors resize-none"
        />
        {error && (
          <p className="text-xs text-destructive mt-1">{error}</p>
        )}

        <button
          onClick={handleSave}
          disabled={isPending}
          className="mt-4 w-full rounded-xl bg-primary py-3 text-sm font-semibold text-background shadow-[0_0_20px_rgba(163,230,53,0.25)] hover:shadow-[0_0_28px_rgba(163,230,53,0.4)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? "Saving..." : "Save & Verify"}
        </button>
      </div>
    </div>,
    document.body
  );
}

function RatingCard({
  rating,
  bookId,
  isLoggedIn,
  isAdmin,
}: {
  rating: Rating;
  bookId?: string;
  isLoggedIn?: boolean;
  isAdmin?: boolean;
}) {
  const [localRating, setLocalRating] = useState(rating);
  const badge = evidenceBadge[localRating.evidenceLevel];
  const displayName = SHORT_NAMES[localRating.categoryKey] ?? localRating.categoryName;
  const [showModal, setShowModal] = useState(false);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium">{displayName}</span>
        <div className="flex items-center gap-1.5">
          {badge && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${badge.className}`}
            >
              {badge.label}
            </span>
          )}
          {bookId && isLoggedIn && (
            <button
              onClick={() => setShowModal(true)}
              className="text-muted/40 hover:text-destructive transition-colors"
              title={isAdmin ? "Edit rating" : "Report incorrect rating"}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="mt-1 flex gap-0.5">
        {[0, 1, 2, 3].map((segment) => (
          <div
            key={segment}
            className={`h-1.5 flex-1 rounded-full ${
              segment < localRating.intensity
                ? intensityColors[localRating.intensity]
                : "bg-surface-alt"
            }`}
          />
        ))}
      </div>
      {localRating.notes && (
        <ExpandableNote text={localRating.notes} />
      )}
      {showModal && bookId && isAdmin && (
        <AdminEditModal
          rating={localRating}
          bookId={bookId}
          onClose={() => setShowModal(false)}
          onSaved={(intensity, notes) => {
            setLocalRating({ ...localRating, intensity, notes, evidenceLevel: "human_verified" });
          }}
        />
      )}
      {showModal && bookId && !isAdmin && (
        <CorrectionModal
          rating={localRating}
          bookId={bookId}
          onClose={() => setShowModal(false)}
        />
      )}
    </div>
  );
}

export function ContentProfile({ ratings, bookId, isLoggedIn, isAdmin }: ContentProfileProps) {
  const [revealed, setRevealed] = useState(false);
  const [verifyPending, startVerifyTransition] = useTransition();
  const [allVerified, setAllVerified] = useState(
    ratings.length > 0 && ratings.every((r) => r.evidenceLevel === "human_verified")
  );

  if (ratings.length === 0) {
    return (
      <section className="mt-8">
        <div className="flex items-center justify-between">
          <h2 className="section-heading text-xl">What&apos;s Inside</h2>
          <Link href="/methodology" className="rounded-full border border-neon-blue/30 bg-neon-blue/10 px-3 py-1 text-xs font-medium hover:bg-neon-blue/20 transition-colors">
            How we rate
          </Link>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-surface p-6 text-center">
          <p className="text-sm text-muted">No content details yet.</p>
          <p className="mt-2 text-xs text-muted">
            Information will be populated soon.
          </p>
        </div>
      </section>
    );
  }

  // Sort ratings by display order
  const sortedRatings = [...ratings].sort((a, b) => {
    const aIdx = CATEGORY_ORDER.indexOf(a.categoryKey);
    const bIdx = CATEGORY_ORDER.indexOf(b.categoryKey);
    return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
  });

  return (
    <section className="mt-8">
      <div className="flex items-center justify-between">
        <h2 className="section-heading text-xl">What&apos;s Inside</h2>
        <div className="flex items-center gap-2">
          {isAdmin && bookId && !allVerified && (
            <button
              onClick={() => {
                startVerifyTransition(async () => {
                  const result = await verifyContentRatings(bookId);
                  if (result.success) {
                    setAllVerified(true);
                  }
                });
              }}
              disabled={verifyPending}
              className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
            >
              {verifyPending ? "Verifying..." : "Verify All"}
            </button>
          )}
          {isAdmin && allVerified && ratings.length > 0 && (
            <span className="rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              All Verified
            </span>
          )}
          <Link href="/methodology" className="rounded-full border border-neon-blue/30 bg-neon-blue/10 px-3 py-1 text-xs font-medium hover:bg-neon-blue/20 transition-colors">
            How we rate
          </Link>
        </div>
      </div>

      <div className="relative mt-4">
        {/* Blurred overlay when not revealed */}
        {!revealed && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-lg">
            <button
              onClick={() => setRevealed(true)}
              className="lime-glow-box rounded-full border border-accent bg-accent/10 px-6 py-3 text-sm font-semibold text-foreground shadow-[0_0_20px_rgba(163,230,53,0.25)] transition-all hover:bg-accent/20 hover:shadow-[0_0_30px_rgba(163,230,53,0.4)]"
            >
              Reveal Content Details
            </button>
            <p className="mt-2 text-xs text-muted">will contain mild spoilers</p>
          </div>
        )}

        {/* Ratings grid — blurred when not revealed */}
        <div
          className={`grid grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 ${!revealed ? "blur-md select-none pointer-events-none" : ""} transition-[filter] duration-300`}
        >
          {sortedRatings.map((rating) => (
            <RatingCard key={rating.categoryKey} rating={rating} bookId={bookId} isLoggedIn={isLoggedIn} isAdmin={isAdmin} />
          ))}
        </div>
      </div>
    </section>
  );
}
