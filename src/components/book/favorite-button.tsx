"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { toggleFavorite } from "@/lib/actions/favorites";

interface FavoriteButtonProps {
  bookId: string;
  isFavorited: boolean;
}

function TopShelfToast({ onDismiss, isFirstAdd }: { onDismiss: () => void; isFirstAdd: boolean }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 3500);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return createPortal(
    <div
      onClick={onDismiss}
      style={{
        position: "fixed",
        bottom: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 9999,
        background: "var(--surface-alt)",
        border: "1px solid var(--border)",
        borderRadius: "12px",
        padding: "12px 16px",
        display: "flex",
        alignItems: "center",
        gap: "10px",
        maxWidth: "calc(100vw - 32px)",
        width: "max-content",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        cursor: "pointer",
        animation: "toast-in 0.25s ease-out",
      }}
    >
      <span
        style={{
          background: "#a3e635",
          color: "#18181b",
          borderRadius: "50%",
          width: "22px",
          height: "22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          fontSize: "13px",
          fontWeight: 700,
        }}
      >
        &#10003;
      </span>
      <span
        style={{
          color: "var(--foreground)",
          fontSize: "13px",
          lineHeight: 1.4,
          fontFamily: "var(--font-body)",
        }}
      >
        {isFirstAdd
          ? "You just added this to your Top Shelf Reads! This is a place for your all-time favorites. Visit your profile to see them all."
          : "Added to Top Shelf!"}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDismiss();
        }}
        style={{
          background: "none",
          border: "none",
          color: "var(--muted)",
          cursor: "pointer",
          padding: "2px",
          fontSize: "16px",
          lineHeight: 1,
          flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        &#10005;
      </button>
    </div>,
    document.body
  );
}

export function FavoriteButton({ bookId, isFavorited: initialFavorited }: FavoriteButtonProps) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [isPending, startTransition] = useTransition();
  const [showToast, setShowToast] = useState(false);
  const [isFirstAdd, setIsFirstAdd] = useState(false);

  const dismissToast = useCallback(() => setShowToast(false), []);

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleFavorite(bookId);
      if (result.success) {
        setFavorited(result.isFavorited);
        if (result.isFavorited) {
          // Check v2 flag (reset from old flag)
          const seen = localStorage.getItem("tbra-topshelf-seen-v2");
          setIsFirstAdd(!seen);
          setShowToast(true);
          localStorage.setItem("tbra-topshelf-seen-v2", "1");
        }
      }
    });
  }

  return (
    <>
      <button
        onClick={handleToggle}
        disabled={isPending}
        className={`flex items-center justify-center gap-1.5 rounded-xl py-3 px-2 text-sm font-semibold whitespace-nowrap transition-all w-full ${
          favorited
            ? "bg-amber-500 text-white shadow-[0_0_16px_rgba(245,158,11,0.3)] border-2 border-amber-500"
            : "bg-amber-500/10 text-muted border-2 border-amber-500/40 hover:text-foreground hover:border-amber-500/70"
        } ${isPending ? "opacity-50" : ""}`}
        title={favorited ? "Remove from Top Shelf" : "Add to Top Shelf"}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill={favorited ? "currentColor" : "none"}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="flex-shrink-0"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        Top Shelf
      </button>
      {showToast && <TopShelfToast onDismiss={dismissToast} isFirstAdd={isFirstAdd} />}
    </>
  );
}
