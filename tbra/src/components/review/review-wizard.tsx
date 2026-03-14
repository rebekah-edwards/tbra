"use client";

import { useReducer, useCallback, useTransition, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { StepOverallRating } from "./steps/step-overall-rating";
import { StepMood } from "./steps/step-mood";
import { StepDimensions } from "./steps/step-dimensions";
import { StepReviewText } from "./steps/step-review-text";
import { saveReview } from "@/lib/actions/review";

const TOTAL_STEPS = 4;

interface ReviewState {
  overallRating: number | null;
  didNotFinish: boolean;
  dnfPercentComplete: number | null;
  reviewText: string | null;
  mood: string | null;
  dimensionRatings: Record<string, number | null>;
  dimensionTags: Record<string, string[]>;
}

type ReviewAction =
  | { type: "SET_RATING"; rating: number | null }
  | { type: "SET_DNF"; dnf: boolean }
  | { type: "SET_DNF_PERCENT"; percent: number | null }
  | { type: "SET_REVIEW_TEXT"; text: string | null }
  | { type: "SET_MOOD"; mood: string | null }
  | { type: "SET_DIMENSION_RATING"; dimension: string; rating: number | null }
  | { type: "TOGGLE_DIMENSION_TAG"; dimension: string; tag: string };

function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case "SET_RATING":
      return { ...state, overallRating: action.rating };
    case "SET_DNF":
      return { ...state, didNotFinish: action.dnf, overallRating: action.dnf ? null : state.overallRating };
    case "SET_DNF_PERCENT":
      return { ...state, dnfPercentComplete: action.percent };
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
  dimensionRatings: Record<string, number | null>;
  dimensionTags: Record<string, string[]>;
} | null): ReviewState {
  if (existing) {
    return {
      overallRating: existing.overallRating,
      didNotFinish: existing.didNotFinish,
      dnfPercentComplete: existing.dnfPercentComplete ?? null,
      reviewText: existing.reviewText ?? null,
      mood: existing.mood,
      dimensionRatings: existing.dimensionRatings,
      dimensionTags: existing.dimensionTags,
    };
  }
  return {
    overallRating: null,
    didNotFinish: false,
    dnfPercentComplete: null,
    reviewText: null,
    mood: null,
    dimensionRatings: {},
    dimensionTags: {},
  };
}

interface ReviewWizardProps {
  bookId: string;
  open: boolean;
  onClose: () => void;
  existingReview?: {
    overallRating: number | null;
    didNotFinish: boolean;
    dnfPercentComplete: number | null;
    reviewText: string | null;
    moodIntensity: number | null;
    mood: string | null;
    dimensionRatings: Record<string, number | null>;
    dimensionTags: Record<string, string[]>;
  } | null;
}

export function ReviewWizard({ bookId, open, onClose, existingReview }: ReviewWizardProps) {
  const [step, setStep] = useReducer(
    (_: number, next: number) => Math.max(0, Math.min(TOTAL_STEPS - 1, next)),
    0
  );
  const [state, dispatch] = useReducer(reviewReducer, existingReview, makeInitialState);
  const [isPending, startTransition] = useTransition();
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  // Animate in/out
  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setAnimating(true));
      });
      setStep(0);
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [open]);

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
      });
      onClose();
    });
  }, [bookId, state, onClose]);

  const isLastStep = step === TOTAL_STEPS - 1;
  // Steps 0-1 are centered, step 2 (dimensions) and step 3 (text) need full height
  const isScrollStep = step >= 2;

  if (!visible) return null;

  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex flex-col bg-background transition-transform duration-300 ease-out ${
        animating ? "translate-y-0" : "translate-y-full"
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          type="button"
          onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
          className="p-2 -m-2 text-foreground/60 hover:text-foreground transition-colors"
          aria-label={step > 0 ? "Back" : "Close"}
        >
          {step > 0 ? (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          )}
        </button>

        <span className="text-xs font-medium text-muted uppercase tracking-wide">
          Step {step + 1} of {TOTAL_STEPS}
        </span>

        <button
          type="button"
          onClick={onClose}
          className="p-2 -m-2 text-foreground/60 hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Progress dots */}
      <div className="flex justify-center gap-3 py-4">
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
      <div className={`flex-1 ${isScrollStep ? "overflow-hidden" : "overflow-y-auto px-4 flex items-center"}`}>
        <div className={`w-full ${isScrollStep ? "h-full" : "-mt-12"}`}>
          {step === 0 && (
            <StepOverallRating
              rating={state.overallRating}
              didNotFinish={state.didNotFinish}
              dnfPercentComplete={state.dnfPercentComplete}
              onRatingChange={(r) => dispatch({ type: "SET_RATING", rating: r })}
              onDnfChange={(d) => dispatch({ type: "SET_DNF", dnf: d })}
              onDnfPercentChange={(p) => dispatch({ type: "SET_DNF_PERCENT", percent: p })}
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
              onDimensionRatingChange={(dim, r) =>
                dispatch({ type: "SET_DIMENSION_RATING", dimension: dim, rating: r })
              }
              onDimensionTagToggle={(dim, tag) =>
                dispatch({ type: "TOGGLE_DIMENSION_TAG", dimension: dim, tag })
              }
            />
          )}
          {step === 3 && (
            <StepReviewText
              text={state.reviewText}
              onChange={(t) => dispatch({ type: "SET_REVIEW_TEXT", text: t })}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="flex gap-3 px-4 py-4 pb-8 border-t border-surface-alt">
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
          {isPending ? "Saving..." : isLastStep ? "Save Review" : "Next"}
        </button>
      </div>
    </div>,
    document.body
  );
}
