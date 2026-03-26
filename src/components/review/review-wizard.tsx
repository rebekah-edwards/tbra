"use client";

import { useReducer, useCallback, useTransition, useEffect, useState, useRef } from "react";
import { createPortal } from "react-dom";
import { StepOverallRating } from "./steps/step-overall-rating";
import { StepMood } from "./steps/step-mood";
import { StepDimensions } from "./steps/step-dimensions";
import { StepReviewText } from "./steps/step-review-text";
import { StepContentDetails } from "./steps/step-content-details";
import { saveReview, deleteReview } from "@/lib/actions/review";

const TOTAL_STEPS = 5;

interface ReviewState {
  overallRating: number | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  dnfMode: "percent" | "pages";
  reviewText: string | null;
  isAnonymous: boolean;
  mood: string | null;
  dimensionRatings: Record<string, number | null>;
  dimensionTags: Record<string, string[]>;
  plotPacing: "slow" | "medium" | "fast" | null;
  customContentWarning: string;
  contentComments: string;
}

type ReviewAction =
  | { type: "SET_RATING"; rating: number | null }
  | { type: "SET_DNF"; dnf: boolean }
  | { type: "SET_DNF_PERCENT"; percent: number | null }
  | { type: "SET_DNF_MODE"; mode: "percent" | "pages" }
  | { type: "SET_REVIEW_TEXT"; text: string | null }
  | { type: "SET_MOOD"; mood: string | null }
  | { type: "SET_DIMENSION_RATING"; dimension: string; rating: number | null }
  | { type: "TOGGLE_DIMENSION_TAG"; dimension: string; tag: string }
  | { type: "SET_PLOT_PACING"; pacing: "slow" | "medium" | "fast" | null }
  | { type: "TOGGLE_CONTENT_TAG"; tag: string }
  | { type: "SET_ANONYMOUS"; anonymous: boolean }
  | { type: "SET_CUSTOM_CW"; text: string }
  | { type: "SET_CONTENT_COMMENTS"; text: string }
  | { type: "RESET"; state: ReviewState };

function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "SET_RATING":
      return { ...state, overallRating: action.rating };
    case "SET_DNF":
      return { ...state, didNotFinish: action.dnf, overallRating: action.dnf ? null : state.overallRating };
    case "SET_DNF_PERCENT":
      return { ...state, dnfPercentComplete: action.percent };
    case "SET_DNF_MODE":
      return { ...state, dnfMode: action.mode };
    case "SET_REVIEW_TEXT":
      return { ...state, reviewText: action.text };
    case "SET_MOOD":
      return { ...state, mood: action.mood };
    case "SET_DIMENSION_RATING":
      return {
        ...state,
        dimensionRatings: { ...state.dimensionRatings, [action.dimension]: action.rating },
      };
    case "TOGGLE_DIMENSION_TAG": {
      const current = state.dimensionTags[action.dimension] ?? [];
      const has = current.includes(action.tag);
      return {
        ...state,
        dimensionTags: {
          ...state.dimensionTags,
          [action.dimension]: has
            ? current.filter((t) => t !== action.tag)
            : [...current, action.tag],
        },
      };
    }
    case "SET_PLOT_PACING":
      return { ...state, plotPacing: action.pacing };
    case "SET_ANONYMOUS":
      return { ...state, isAnonymous: action.anonymous };
    case "TOGGLE_CONTENT_TAG": {
      const current = state.dimensionTags["content_details"] ?? [];
      const has = current.includes(action.tag);
      return {
        ...state,
        dimensionTags: {
          ...state.dimensionTags,
          content_details: has
            ? current.filter((t) => t !== action.tag)
            : [...current, action.tag],
        },
      };
    }
    case "SET_CUSTOM_CW":
      return { ...state, customContentWarning: action.text };
    case "SET_CONTENT_COMMENTS":
      return { ...state, contentComments: action.text };
    case "RESET":
      return action.state;
    default:
      return state;
  }
}

function makeInitialState(existing?: {
  overallRating: number | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  reviewText: string | null;
  moodIntensity: number | null;
  mood: string | null;
  isAnonymous?: boolean;
  dimensionRatings: Record<string, number | null>;
  dimensionTags: Record<string, string[]>;
  plotPacing?: "slow" | "medium" | "fast" | null;
  customContentWarning?: string;
  contentComments?: string;
} | null): ReviewState {
  if (existing) {
    return {
      overallRating: existing.overallRating,
      didNotFinish: existing.didNotFinish,
      dnfPercentComplete: existing.dnfPercentComplete ?? null,
      dnfMode: "percent",
      reviewText: existing.reviewText ?? null,
      isAnonymous: existing.isAnonymous ?? false,
      mood: existing.mood,
      dimensionRatings: existing.dimensionRatings,
      dimensionTags: existing.dimensionTags,
      plotPacing: existing.plotPacing ?? null,
      customContentWarning: existing.customContentWarning ?? "",
      contentComments: existing.contentComments ?? "",
    };
  }
  return {
    overallRating: null,
    didNotFinish: false,
    dnfPercentComplete: null,
    dnfMode: "percent",
    reviewText: null,
    isAnonymous: false,
    mood: null,
    dimensionRatings: {},
    dimensionTags: {},
    plotPacing: null,
    customContentWarning: "",
    contentComments: "",
  };
}

function statesEqual(a: ReviewState, b: ReviewState): boolean {
  return (
    a.overallRating === b.overallRating &&
    a.didNotFinish === b.didNotFinish &&
    a.dnfPercentComplete === b.dnfPercentComplete &&
    a.reviewText === b.reviewText &&
    a.isAnonymous === b.isAnonymous &&
    a.mood === b.mood &&
    a.plotPacing === b.plotPacing &&
    a.customContentWarning === b.customContentWarning &&
    a.contentComments === b.contentComments &&
    JSON.stringify(a.dimensionRatings) === JSON.stringify(b.dimensionRatings) &&
    JSON.stringify(a.dimensionTags) === JSON.stringify(b.dimensionTags)
  );
}

interface ReviewWizardProps {
  bookId: string;
  bookPages?: number | null;
  open: boolean;
  onClose: () => void;
  isExisting: boolean;
  existingReview?: {
    overallRating: number | null;
    didNotFinish: boolean;
    dnfPercentComplete: number | null;
    reviewText: string | null;
    moodIntensity: number | null;
    mood: string | null;
    isAnonymous?: boolean;
    dimensionRatings: Record<string, number | null>;
    dimensionTags: Record<string, string[]>;
    plotPacing?: "slow" | "medium" | "fast" | null;
    customContentWarning?: string;
    contentComments?: string;
  } | null;
}

export function ReviewWizard({ bookId, bookPages, open, onClose, isExisting, existingReview }: ReviewWizardProps) {
  const [step, setStep] = useReducer(
    (_: number, next: number) => Math.max(0, Math.min(TOTAL_STEPS - 1, next)),
    0
  );
  const [state, dispatch] = useReducer(reviewReducer, existingReview, makeInitialState);
  const [isPending, startTransition] = useTransition();
  const [isDeletePending, startDeleteTransition] = useTransition();
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showExitConfirm, setShowExitConfirm] = useState(false);
  const initialStateRef = useRef<ReviewState>(makeInitialState(existingReview));

  // Animate in/out — reset state each time wizard opens
  useEffect(() => {
    if (open) {
      setVisible(true);
      const fresh = makeInitialState(existingReview);
      initialStateRef.current = fresh;
      dispatch({ type: "RESET", state: fresh });
      setShowDeleteConfirm(false);
      setShowExitConfirm(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(true));
      });
      setStep(0);
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open, existingReview]);

  // Lock body scroll
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const handleSave = useCallback(() => {
    startTransition(async () => {
      await saveReview({
        bookId,
        overallRating: state.overallRating,
        didNotFinish: state.didNotFinish,
        dnfPercentComplete: state.dnfPercentComplete,
        reviewText: state.reviewText,
        mood: state.mood,
        dimensionRatings: state.dimensionRatings,
        dimensionTags: state.dimensionTags,
        plotPacing: state.plotPacing,
        customContentWarning: state.customContentWarning || null,
        contentComments: state.contentComments || null,
        isAnonymous: state.isAnonymous,
      });
      onClose();
    });
  }, [bookId, state, onClose]);

  const handleDelete = useCallback(() => {
    startDeleteTransition(async () => {
      await deleteReview(bookId);
      setShowDeleteConfirm(false);
      onClose();
    });
  }, [bookId, onClose]);

  const handleCloseAttempt = useCallback(() => {
    const isDirty = !statesEqual(state, initialStateRef.current);
    if (isDirty) {
      setShowExitConfirm(true);
    } else {
      onClose();
    }
  }, [state, onClose]);

  const isLastStep = step === TOTAL_STEPS - 1;
  // Steps 2 (dimensions), 3 (review text), 4 (content details) need scroll containment
  const isScrollStep = step === 2 || step === 3 || step === 4;

  if (!visible) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-background transition-transform duration-300 ease-out ${
        animating ? "translate-y-0" : "translate-y-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        {step > 0 ? (
          <button
            type="button"
            onClick={() => setStep(step - 1)}
            className="p-2 -m-2 text-foreground/60 hover:text-foreground transition-colors"
            aria-label="Back"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        ) : (
          <div className="w-10" />
        )}

        <span className="text-xs font-medium text-muted uppercase tracking-wide">
          Step {step + 1} of {TOTAL_STEPS}
        </span>

        <button
          type="button"
          onClick={handleCloseAttempt}
          className="p-2 -m-2 text-foreground/60 hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-3 py-2">
        {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
          <div
            key={i}
            className={`w-3 h-3 rounded-full transition-all duration-300 ${
              i === step
                ? "bg-primary scale-110"
                : i < step
                  ? "bg-primary/50"
                  : "bg-surface-alt"
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className={`flex-1 min-h-0 ${isScrollStep ? "overflow-hidden" : "overflow-y-auto px-4 flex items-center"}`}>
        <div className={`w-full ${isScrollStep ? "h-full" : "-mt-12"}`}>
          {step === 0 && (
            <StepOverallRating
              rating={state.overallRating}
              didNotFinish={state.didNotFinish}
              dnfPercentComplete={state.dnfPercentComplete}
              dnfMode={state.dnfMode}
              bookPages={bookPages ?? null}
              onRatingChange={(r) => dispatch({ type: "SET_RATING", rating: r })}
              onDnfChange={(d) => dispatch({ type: "SET_DNF", dnf: d })}
              onDnfPercentChange={(p) => dispatch({ type: "SET_DNF_PERCENT", percent: p })}
              onDnfModeChange={(m) => dispatch({ type: "SET_DNF_MODE", mode: m })}
            />
          )}
          {step === 1 && (
            <StepMood
              selected={state.mood}
              onSelect={(m) => dispatch({ type: "SET_MOOD", mood: m })}
            />
          )}
          {step === 2 && (
            <StepDimensions
              dimensionRatings={state.dimensionRatings}
              dimensionTags={state.dimensionTags}
              plotPacing={state.plotPacing}
              onDimensionRatingChange={(dim, r) =>
                dispatch({ type: "SET_DIMENSION_RATING", dimension: dim, rating: r })
              }
              onDimensionTagToggle={(dim, tag) =>
                dispatch({ type: "TOGGLE_DIMENSION_TAG", dimension: dim, tag })
              }
              onPlotPacingChange={(p) => dispatch({ type: "SET_PLOT_PACING", pacing: p })}
            />
          )}
          {step === 3 && (
            <StepReviewText
              text={state.reviewText}
              isAnonymous={state.isAnonymous}
              onChange={(t) => dispatch({ type: "SET_REVIEW_TEXT", text: t })}
              onAnonymousChange={(a) => dispatch({ type: "SET_ANONYMOUS", anonymous: a })}
            />
          )}
          {step === 4 && (
            <StepContentDetails
              selectedTags={state.dimensionTags["content_details"] ?? []}
              customContentWarning={state.customContentWarning}
              contentComments={state.contentComments}
              onTagToggle={(tag) => dispatch({ type: "TOGGLE_CONTENT_TAG", tag })}
              onCustomWarningChange={(t) => dispatch({ type: "SET_CUSTOM_CW", text: t })}
              onContentCommentsChange={(t) => dispatch({ type: "SET_CONTENT_COMMENTS", text: t })}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-4 pb-8 border-t border-surface-alt space-y-3">
        {isExisting && !showDeleteConfirm && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-2.5 rounded-xl text-sm font-medium border border-destructive/40 text-destructive hover:bg-destructive/10 transition-colors"
          >
            Delete Review
          </button>
        )}

        {showDeleteConfirm && (
          <div className="flex items-center justify-center gap-3 py-2.5 px-3 rounded-xl bg-destructive/10 border border-destructive/30">
            <button
              type="button"
              onClick={handleDelete}
              disabled={isDeletePending}
              className="text-sm text-destructive font-semibold hover:text-destructive/80 transition-colors"
            >
              {isDeletePending ? "Deleting..." : "Yes, delete my review"}
            </button>
            <span className="text-muted">&middot;</span>
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(false)}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => (isLastStep ? handleSave() : setStep(step + 1))}
            className="flex-1 text-sm text-muted hover:text-foreground py-3 transition-colors"
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => (isLastStep ? handleSave() : setStep(step + 1))}
            disabled={isPending}
            className={`flex-[2] py-3 rounded-xl font-medium text-background transition-all ${
              isPending ? "bg-primary/50" : "bg-foreground hover:bg-foreground/90 active:scale-[0.98]"
            }`}
          >
            {isPending ? "Posting..." : isLastStep ? "Post Review" : "Next"}
          </button>
        </div>
      </div>

      {/* Exit confirmation dialog */}
      {showExitConfirm && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-xs rounded-2xl bg-surface border border-border p-5 shadow-2xl">
            <h3 className="text-base font-bold text-foreground text-center mb-2">
              Discard changes?
            </h3>
            <p className="text-sm text-muted text-center mb-5">
              Your review progress will be lost if you exit now.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirm(false);
                  onClose();
                }}
                className="w-full py-2.5 rounded-xl text-sm font-semibold bg-destructive text-white hover:bg-destructive/90 transition-colors"
              >
                Discard
              </button>
              <button
                type="button"
                onClick={() => setShowExitConfirm(false)}
                className="w-full py-2.5 rounded-xl text-sm font-medium text-muted hover:text-foreground transition-colors"
              >
                Keep editing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
