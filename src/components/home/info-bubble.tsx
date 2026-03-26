"use client";

import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";

interface InfoBubbleProps {
  children: React.ReactNode;
}

function InfoModal({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-6"
      onClick={onClose}
    >
      {/* Dimmed backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal content */}
      <div
        className="relative rounded-2xl border border-border bg-surface p-5 max-w-sm w-full shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 text-muted hover:text-foreground transition-colors"
          aria-label="Close"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <div className="text-sm text-foreground/80 leading-relaxed pr-4">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

export function InfoBubble({ children }: InfoBubbleProps) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center justify-center h-5 w-5 rounded-full border border-muted/30 text-muted hover:text-foreground hover:border-muted/50 transition-colors text-[10px] font-semibold flex-shrink-0"
        aria-label="More info"
      >
        ?
      </button>

      {open && <InfoModal onClose={close}>{children}</InfoModal>}
    </>
  );
}
