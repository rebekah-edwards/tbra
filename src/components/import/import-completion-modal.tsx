"use client";

import { useState, useEffect } from "react";

interface ImportCompletionModalProps {
  importedCount: number;
  hasEnrichment: boolean;
  onDismiss: () => void;
}

export function ImportCompletionModal({ importedCount, hasEnrichment, onDismiss }: ImportCompletionModalProps) {
  const [displayCount, setDisplayCount] = useState(0);
  const [animationPhase, setAnimationPhase] = useState<"opening" | "fanning" | "done">("opening");

  // Count-up animation
  useEffect(() => {
    if (importedCount <= 0) {
      setDisplayCount(0);
      return;
    }

    const duration = 1500; // 1.5s total
    const steps = Math.min(importedCount, 60);
    const stepInterval = duration / steps;
    let current = 0;

    const timer = setInterval(() => {
      current++;
      const progress = current / steps;
      // Ease-out curve
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setDisplayCount(Math.round(easedProgress * importedCount));

      if (current >= steps) {
        setDisplayCount(importedCount);
        clearInterval(timer);
      }
    }, stepInterval);

    return () => clearInterval(timer);
  }, [importedCount]);

  // Book animation phases
  useEffect(() => {
    const t1 = setTimeout(() => setAnimationPhase("fanning"), 600);
    const t2 = setTimeout(() => setAnimationPhase("done"), 1400);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-surface border border-border rounded-2xl w-full max-w-sm mx-4 p-8 text-center space-y-6 animate-in fade-in zoom-in-95 duration-300">
        {/* Animated book */}
        <div className="relative w-24 h-28 mx-auto">
          {/* Book spine/back cover */}
          <div className="absolute inset-0 bg-accent/20 border border-accent/30" style={{ borderRadius: "2px 4px 4px 2px" }} />

          {/* Pages fanning out */}
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className="absolute top-1 bottom-1 bg-surface border border-border/40"
              style={{
                left: "4px",
                right: "4px",
                borderRadius: "1px 3px 3px 1px",
                transformOrigin: "left center",
                transform:
                  animationPhase === "opening"
                    ? "rotateY(0deg)"
                    : animationPhase === "fanning"
                      ? `rotateY(-${(i + 1) * 12}deg) translateX(${(i + 1) * 2}px)`
                      : `rotateY(-${(i + 1) * 15}deg) translateX(${(i + 1) * 3}px)`,
                transition: `transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.08}s`,
                zIndex: 5 - i,
              }}
            />
          ))}

          {/* Front cover */}
          <div
            className="absolute inset-0 bg-accent border border-accent/60"
            style={{
              borderRadius: "2px 4px 4px 2px",
              transformOrigin: "left center",
              transform:
                animationPhase === "opening"
                  ? "rotateY(0deg)"
                  : animationPhase === "fanning"
                    ? "rotateY(-40deg)"
                    : "rotateY(-70deg)",
              transition: "transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1)",
              zIndex: 10,
            }}
          >
            {/* Cover decoration */}
            <div className="absolute inset-3 border border-black/10 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#18181b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-30">
                <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
              </svg>
            </div>
          </div>
        </div>

        {/* Count */}
        <div>
          <p className="text-3xl font-bold font-heading text-accent tabular-nums">
            {displayCount.toLocaleString()}
          </p>
          <p className="text-sm font-medium text-foreground mt-1">
            books imported to your library!
          </p>
        </div>

        {/* Enrichment note */}
        {hasEnrichment && (
          <p className="text-xs text-muted leading-relaxed">
            Book details are being added in the background.
            <br />
            Please allow 20&ndash;30 minutes for all data to appear.
          </p>
        )}

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className="inline-flex items-center gap-1.5 bg-accent text-black px-5 py-2.5 rounded-xl text-sm font-semibold hover:brightness-110 transition-all"
        >
          Start exploring
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </button>
      </div>
    </div>
  );
}
