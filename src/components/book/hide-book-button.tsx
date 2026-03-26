"use client";

import { useState } from "react";
import { hideBook, unhideBook } from "@/lib/actions/hidden-books";
import { useRouter } from "next/navigation";

interface HideBookButtonProps {
  bookId: string;
  bookTitle: string;
  initialIsHidden: boolean;
}

export function HideBookButton({ bookId, bookTitle, initialIsHidden }: HideBookButtonProps) {
  const [hidden, setHidden] = useState(initialIsHidden);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  return (
    <button
      onClick={async () => {
        setPending(true);
        try {
          if (hidden) {
            await unhideBook(bookId);
            setHidden(false);
          } else {
            await hideBook(bookId);
            setHidden(true);
          }
          router.refresh();
        } catch {
          // ignore
        } finally {
          setPending(false);
        }
      }}
      disabled={pending}
      className="hide-book-btn flex items-center gap-1.5 text-xs transition-colors disabled:opacity-50 mx-auto"
    >
      {hidden ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
          <circle cx="12" cy="12" r="3" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
          <line x1="2" x2="22" y1="2" y2="22" />
        </svg>
      )}
      {hidden ? "Unhide this book from recommendations" : "Hide this book from recommendations"}
    </button>
  );
}
