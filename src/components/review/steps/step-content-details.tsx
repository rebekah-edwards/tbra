"use client";

import { useState, useCallback } from "react";
import { CONTENT_DETAILS_TAGS, BLOCKED_CW_KEYWORDS } from "@/lib/review-constants";

interface StepContentDetailsProps {
  selectedTags: string[];
  customContentWarning: string;
  contentComments: string;
  onTagToggle: (tag: string) => void;
  onCustomWarningChange: (text: string) => void;
  onContentCommentsChange: (text: string) => void;
}

const MAX_CUSTOM_LENGTH = 100;

function isBlocked(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_CW_KEYWORDS.some((kw) => lower.includes(kw));
}

export function StepContentDetails({
  selectedTags,
  customContentWarning,
  contentComments,
  onTagToggle,
  onCustomWarningChange,
  onContentCommentsChange,
}: StepContentDetailsProps) {
  const [showCustomInput, setShowCustomInput] = useState(customContentWarning.length > 0);
  const [showBlockedWarning, setShowBlockedWarning] = useState(false);
  const [showInfoTooltip, setShowInfoTooltip] = useState(false);

  const handleCustomChange = useCallback(
    (value: string) => {
      if (value.length > MAX_CUSTOM_LENGTH) return;
      if (isBlocked(value)) {
        setShowBlockedWarning(true);
        return;
      }
      setShowBlockedWarning(false);
      onCustomWarningChange(value);
    },
    [onCustomWarningChange]
  );

  const toggleCustom = useCallback(() => {
    if (showCustomInput) {
      // Closing — clear the custom warning
      onCustomWarningChange("");
      setShowBlockedWarning(false);
    }
    setShowCustomInput((v) => !v);
  }, [showCustomInput, onCustomWarningChange]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <h2 className="font-heading text-xl font-bold text-center pb-1 px-4">
        What&apos;s in this book?
      </h2>
      <p className="text-xs text-muted text-center pb-4 px-4">
        Check all of the below that appeared in this book to help other readers
      </p>

      <div className="flex-1 overflow-y-auto px-4">
        {/* Content warning tag pills */}
        <div className="flex flex-wrap gap-2 justify-center">
          {CONTENT_DETAILS_TAGS.map((tag) => {
            const isSelected = selectedTags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => onTagToggle(tag)}
                className={`rounded-full px-4 py-2 text-sm transition-all ${
                  isSelected
                    ? "bg-purple-500/20 border-2 border-purple-400 text-purple-700 dark:text-purple-300 font-medium"
                    : "bg-transparent border-2 border-purple-500/30 text-foreground/70 hover:border-purple-400/50"
                }`}
              >
                {tag}
              </button>
            );
          })}

          {/* Custom pill toggle */}
          <button
            type="button"
            onClick={toggleCustom}
            className={`rounded-full px-4 py-2 text-sm transition-all ${
              showCustomInput
                ? "bg-purple-500/20 border-2 border-purple-400 text-purple-700 dark:text-purple-300 font-medium"
                : "bg-transparent border-2 border-purple-500/30 text-foreground/70 hover:border-purple-400/50"
            }`}
          >
            + Custom
          </button>
        </div>

        {/* Custom input revealed by pill */}
        {showCustomInput && (
          <div className="mt-4">
            <input
              type="text"
              value={customContentWarning}
              onChange={(e) => handleCustomChange(e.target.value)}
              placeholder="Describe the content..."
              maxLength={MAX_CUSTOM_LENGTH}
              className="w-full rounded-xl border-2 border-purple-500/30 bg-surface-alt/30 px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-purple-400 focus:outline-none transition-colors"
            />
            <div className="flex justify-between mt-1.5 px-1">
              {showBlockedWarning ? (
                <p className="text-xs text-destructive">
                  This content isn&apos;t allowed
                </p>
              ) : (
                <div />
              )}
              <p className="text-xs text-muted">
                {customContentWarning.length}/{MAX_CUSTOM_LENGTH}
              </p>
            </div>
          </div>
        )}

        {/* Comments section */}
        <div className="mt-8 mb-8">
          <div className="flex items-center justify-center gap-2 mb-3">
            <p className="text-xs text-muted text-center">
              Want to share more details about any of the content in this book? Leave your comments below.
            </p>
            <button
              type="button"
              onClick={() => setShowInfoTooltip((v) => !v)}
              className="shrink-0 w-5 h-5 rounded-full border border-muted/40 flex items-center justify-center text-muted hover:text-foreground hover:border-foreground/40 transition-colors"
              aria-label="More info"
            >
              <span className="text-[10px] font-bold leading-none">i</span>
            </button>
          </div>

          {showInfoTooltip && (
            <div className="mb-3 mx-2 rounded-xl bg-surface-alt/80 border border-border/50 px-4 py-3">
              <p className="text-xs text-muted leading-relaxed">
                These comments will be visible to you but not public to other users.
                Your comments may be aggregated with those of other readers to
                strengthen content details on this book&apos;s page.
              </p>
            </div>
          )}

          <textarea
            rows={3}
            value={contentComments}
            onChange={(e) => onContentCommentsChange(e.target.value)}
            placeholder="Optional details about content in this book..."
            className="w-full rounded-xl border-2 border-surface-alt bg-surface-alt/30 px-4 py-3 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none transition-colors resize-none"
          />
        </div>
      </div>
    </div>
  );
}
