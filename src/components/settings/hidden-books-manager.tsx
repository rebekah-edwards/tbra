"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { unhideBook } from "@/lib/actions/hidden-books";

interface HiddenBook {
  bookId: string;
  title: string;
  coverImageUrl: string | null;
  authors: string[];
}

interface HiddenBooksManagerProps {
  initialBooks: HiddenBook[];
}

export function HiddenBooksManager({ initialBooks }: HiddenBooksManagerProps) {
  const [books, setBooks] = useState(initialBooks);
  const [isPending, startTransition] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const router = useRouter();

  function handleUnhide(bookId: string) {
    setRemovingId(bookId);
    startTransition(async () => {
      await unhideBook(bookId);
      setBooks((prev) => prev.filter((b) => b.bookId !== bookId));
      setRemovingId(null);
      router.refresh();
    });
  }

  if (books.length === 0) {
    return (
      <p className="text-sm text-muted">No hidden books</p>
    );
  }

  return (
    <div className="space-y-2">
      {books.map((book) => (
        <div
          key={book.bookId}
          className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2"
        >
          {/* Cover */}
          <div className="h-12 w-8 flex-shrink-0 overflow-hidden rounded bg-surface-alt">
            {book.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={book.coverImageUrl}
                alt={book.title}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[8px] text-muted">
                No cover
              </div>
            )}
          </div>

          {/* Info */}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-foreground truncate">
              {book.title}
            </p>
            {book.authors.length > 0 && (
              <p className="text-xs text-muted truncate">
                {book.authors.join(", ")}
              </p>
            )}
          </div>

          {/* Unhide button */}
          <button
            onClick={() => handleUnhide(book.bookId)}
            disabled={isPending && removingId === book.bookId}
            className="flex-shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:bg-surface-alt transition-colors disabled:opacity-50"
          >
            {isPending && removingId === book.bookId ? "..." : "Unhide"}
          </button>
        </div>
      ))}
    </div>
  );
}
