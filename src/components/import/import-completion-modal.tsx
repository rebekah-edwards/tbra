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
        {/* Animated book — 3D perspective */}
        <div className="relative w-32 h-40 mx-auto" style={{ perspective: "400px" }}>
          {/* Book spine (left edge) */}
          <div
            className="absolute left-0 top-0 w-3 h-full rounded-l-sm"
            style={{ background: "linear-gradient(to right, #65a30d, #84cc16)", zIndex: 1 }}
          />

          {/* Back cover */}
          <div
            className="absolute top-0 left-2 right-0 h-full rounded-r-lg border border-accent/30"
            style={{ background: "linear-gradient(135deg, rgba(163,230,53,0.15), rgba(163,230,53,0.05))", zIndex: 0 }}
          />

          {/* Pages fanning out */}
          {[...Array(6)].map((_, i) => (
            <div
              key={i}
              className="absolute top-1.5 bottom-1.5 left-3 right-1 rounded-r-sm"
              style={{
                background: `linear-gradient(to right, #f5f5f0 ${90 - i * 5}%, #e8e8e0)`,
                borderRight: "1px solid rgba(0,0,0,0.08)",
                borderTop: "1px solid rgba(0,0,0,0.04)",
                borderBottom: "1px solid rgba(0,0,0,0.04)",
                transformOrigin: "left center",
                transform: animationPhase === "opening"
                  ? "rotateY(0deg)"
                  : `rotateY(-${(i + 1) * (animationPhase === "fanning" ? 8 : 11)}deg)`,
                transition: `transform 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) ${i * 0.06}s`,
                zIndex: 6 - i,
              }}
            />
          ))}

          {/* Front cover */}
          <div
            className="absolute top-0 left-2 right-0 h-full rounded-r-lg shadow-lg"
            style={{
              background: "linear-gradient(135deg, #a3e635, #84cc16)",
              border: "1px solid rgba(101,163,13,0.5)",
              transformOrigin: "left center",
              transform: animationPhase === "opening"
                ? "rotateY(0deg)"
                : animationPhase === "fanning"
                  ? "rotateY(-50deg)"
                  : "rotateY(-75deg)",
              transition: "transform 0.7s cubic-bezier(0.34, 1.56, 0.64, 1)",
              zIndex: 10,
            }}
          >
            {/* Cover details */}
            <div className="absolute inset-3 border border-black/10 rounded flex flex-col items-center justify-center gap-1">
              <div className="w-8 h-0.5 bg-black/15 rounded" />
              <div className="w-12 h-0.5 bg-black/10 rounded" />
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#18181b" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="opacity-20 mt-1">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
              </svg>
              <div className="w-6 h-0.5 bg-black/10 rounded mt-1" />
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
