"use client";

import { useState, useTransition } from "react";
import {
  addLandingBook,
  removeLandingBook,
  setFeaturedBook,
} from "@/lib/actions/landing";
import { useRouter } from "next/navigation";

interface LandingBook {
  id: string;
  bookSlug: string;
  type: string;
  sortOrder: number;
  bookTitle: string | null;
  coverImageUrl: string | null;
}

interface Props {
  paradeBooks: LandingBook[];
  featuredBook: LandingBook | null;
}

export function LandingAdminClient({ paradeBooks, featuredBook }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [urlInput, setUrlInput] = useState("");
  const [addType, setAddType] = useState<"parade" | "featured">("parade");
  const [addMessage, setAddMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);

  const handleAddByUrl = () => {
    // Extract slug from URL like /book/some-slug or https://thebasedreader.app/book/some-slug or localhost:3000/book/some-slug
    const match = urlInput.match(/\/book\/([^/?#]+)/);
    if (!match) {
      setAddMessage({ text: "Couldn't find a book slug in that URL", type: "error" });
      setTimeout(() => setAddMessage(null), 3000);
      return;
    }
    const slug = match[1];

    startTransition(async () => {
      if (addType === "featured") {
        await setFeaturedBook(slug);
      } else {
        await addLandingBook(slug, "parade");
      }
      setUrlInput("");
      setAddMessage({ text: `Added "${slug}"`, type: "success" });
      setTimeout(() => setAddMessage(null), 3000);
      router.refresh();
    });
  };

  const handleRemove = (id: string) => {
    startTransition(async () => {
      await removeLandingBook(id);
      router.refresh();
    });
  };

  // Check which slugs are already added
  const existingSlugs = new Set([
    ...paradeBooks.map((b) => b.bookSlug),
    ...(featuredBook ? [featuredBook.bookSlug] : []),
  ]);

  return (
    <div className="space-y-10">
      {/* Featured Book */}
      <section>
        <h2 className="section-heading text-lg mb-3">Featured Book</h2>
        <p className="text-xs text-muted mb-3">
          The book shown in the &ldquo;What&apos;s Inside&rdquo; showcase on the landing page.
        </p>
        {featuredBook ? (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
            {featuredBook.coverImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={featuredBook.coverImageUrl}
                alt=""
                className="w-10 h-14 rounded object-cover flex-shrink-0"
              />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                {featuredBook.bookTitle || featuredBook.bookSlug}
              </p>
              <p className="text-xs text-muted truncate">{featuredBook.bookSlug}</p>
            </div>
            <button
              onClick={() => handleRemove(featuredBook.id)}
              disabled={isPending}
              className="text-xs text-destructive hover:text-destructive/80 transition-colors px-2 py-1"
            >
              Remove
            </button>
          </div>
        ) : (
          <p className="text-sm text-muted italic">No featured book set. Use search below to add one.</p>
        )}
      </section>

      {/* Parade Books */}
      <section>
        <h2 className="section-heading text-lg mb-3">
          Book Parade ({paradeBooks.length})
        </h2>
        <p className="text-xs text-muted mb-3">
          Books shown in the hero background and scrollable parade on the landing page.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {paradeBooks.map((book) => (
            <div
              key={book.id}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface p-2 group"
            >
              <a href={`/book/${book.bookSlug}`} className="flex-shrink-0">
                {book.coverImageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={book.coverImageUrl}
                    alt=""
                    className="w-8 h-12 rounded object-cover hover:brightness-110 transition-all"
                  />
                ) : (
                  <div className="w-8 h-12 rounded bg-surface-alt" />
                )}
              </a>
              <div className="flex-1 min-w-0">
                <a href={`/book/${book.bookSlug}`} className="text-xs font-medium truncate hover:text-primary transition-colors block">
                  {book.bookTitle || book.bookSlug}
                </a>
              </div>
              <button
                onClick={() => handleRemove(book.id)}
                disabled={isPending}
                className="opacity-0 group-hover:opacity-100 text-xs text-destructive hover:text-destructive/80 transition-all px-1"
                title="Remove"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </section>

      {/* Search & Add */}
      <section>
        <h2 className="section-heading text-lg mb-3">Add Books</h2>
        <div className="flex items-center gap-2 mb-3">
          <label className="text-xs text-muted">Add as:</label>
          <button
            onClick={() => setAddType("parade")}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              addType === "parade"
                ? "bg-accent/20 border-accent text-accent-dark"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            Parade
          </button>
          <button
            onClick={() => setAddType("featured")}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              addType === "featured"
                ? "bg-accent/20 border-accent text-accent-dark"
                : "border-border text-muted hover:text-foreground"
            }`}
          >
            Featured
          </button>
        </div>
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddByUrl()}
            placeholder="Paste book URL (e.g. /book/the-way-of-kings-brandon-sanderson)"
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
          <button
            onClick={handleAddByUrl}
            disabled={isPending || !urlInput.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-black hover:brightness-110 transition-all disabled:opacity-50"
          >
            Add
          </button>
        </div>
        {addMessage && (
          <p className={`text-xs font-medium ${addMessage.type === "success" ? "text-accent" : "text-destructive"}`}>
            {addMessage.text}
          </p>
        )}
      </section>
    </div>
  );
}
