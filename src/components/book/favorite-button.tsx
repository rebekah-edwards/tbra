"use client";

import { useState, useTransition } from "react";
import { toggleFavorite } from "@/lib/actions/favorites";

interface FavoriteButtonProps {
  bookId: string;
  isFavorited: boolean;
}

export function FavoriteButton({ bookId, isFavorited: initialFavorited }: FavoriteButtonProps) {
  const [favorited, setFavorited] = useState(initialFavorited);
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    startTransition(async () => {
      const result = await toggleFavorite(bookId);
      if (result.success) {
        setFavorited(result.isFavorited);
      }
    });
  }

  return (
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
  );
}
