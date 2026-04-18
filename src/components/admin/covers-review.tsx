"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { saveManualCover, archiveBook } from "@/lib/actions/covers";

type BookRow = {
  id: string;
  title: string;
  slug: string | null;
  coverImageUrl: string | null;
  coverSource: string | null;
  authorNames: string[];
  userCount: number;
  createdAt: string;
};

type Counts = { priority: number; all: number; abandon: number };
type Tab = "priority" | "all" | "abandon";

type Props = {
  books: BookRow[];
  counts: Counts;
  activeTab: Tab;
  page: number;
  pageSize: number;
};

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "priority", label: "Priority", hint: "Books users care about" },
  { key: "all", label: "All pending", hint: "Every book missing a cover" },
  { key: "abandon", label: "Abandon candidates", hint: "Zero user activity" },
];

function sourceLabel(src: string | null) {
  if (!src) return "never attempted";
  if (src === "isbndb-placeholder-cleared") return "placeholder cleared";
  if (src === "none-found") return "no cover found";
  return src;
}

function BookRow({
  book,
  onSaved,
  onArchived,
}: {
  book: BookRow;
  onSaved: () => void;
  onArchived: () => void;
}) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    if (!url.trim()) {
      setError("URL required");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await saveManualCover(book.id, url);
      if (!res.success) {
        setError(res.error ?? "Save failed");
        return;
      }
      setUrl("");
      onSaved();
    });
  }

  function handleArchive() {
    if (!confirm(`Archive "${book.title}"? This hides the book from the public catalog.`)) {
      return;
    }
    startTransition(async () => {
      const res = await archiveBook(book.id);
      if (!res.success) {
        setError(res.error ?? "Archive failed");
        return;
      }
      onArchived();
    });
  }

  const bookHref = book.slug ? `/book/${book.slug}` : `/book/${book.id}`;

  return (
    <div className="flex gap-4 rounded-lg border border-border bg-surface p-4">
      {/* Cover thumbnail */}
      <div className="shrink-0 w-16 h-24 rounded bg-surface-alt border border-border flex items-center justify-center overflow-hidden">
        {book.coverImageUrl ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={book.coverImageUrl}
            alt=""
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-[9px] text-muted text-center px-1">no cover</span>
        )}
      </div>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={bookHref}
              target="_blank"
              className="font-semibold text-foreground hover:text-neon-blue line-clamp-1"
            >
              {book.title}
            </Link>
            <p className="text-xs text-muted line-clamp-1 mt-0.5">
              {book.authorNames.length > 0 ? book.authorNames.join(", ") : "— no author —"}
            </p>
            <div className="flex gap-2 text-[10px] text-muted/70 mt-1">
              <span>{book.userCount} user{book.userCount === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>source: {sourceLabel(book.coverSource)}</span>
            </div>
          </div>
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste Amazon cover URL..."
            disabled={isPending}
            className="flex-1 rounded border border-border bg-surface-alt px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || !url.trim()}
            className="rounded bg-accent px-3 py-1.5 text-sm font-semibold text-[#18181b] disabled:opacity-40"
          >
            Save
          </button>
          <button
            type="button"
            onClick={handleArchive}
            disabled={isPending}
            className="rounded border border-border bg-transparent px-3 py-1.5 text-sm text-muted hover:text-foreground hover:border-muted disabled:opacity-40"
            title="Hide from public catalog"
          >
            Archive
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
      </div>
    </div>
  );
}

export function CoversReview({ books, counts, activeTab, page, pageSize }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function setTab(tab: Tab) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    params.delete("page");
    startTransition(() => router.replace(`/admin/covers?${params.toString()}`));
  }

  function setPage(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    startTransition(() => router.replace(`/admin/covers?${params.toString()}`));
  }

  function refresh() {
    startTransition(() => router.refresh());
  }

  const total = counts[activeTab];
  const maxPage = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`relative px-3 py-2 text-sm transition-colors ${
              activeTab === t.key
                ? "text-foreground font-semibold"
                : "text-muted hover:text-foreground"
            }`}
            title={t.hint}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-muted/70">({counts[t.key].toLocaleString()})</span>
            {activeTab === t.key && (
              <span className="absolute left-3 right-3 -bottom-px h-[2px] rounded-full bg-accent" />
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {books.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          Nothing pending in this tab — 🎉
        </div>
      ) : (
        <div className="space-y-3">
          {books.map((b) => (
            <BookRow
              key={b.id}
              book={b}
              onSaved={refresh}
              onArchived={refresh}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted">
            Showing {(page - 1) * pageSize + 1}–
            {Math.min(page * pageSize, total)} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
              className="rounded border border-border px-3 py-1 text-sm text-muted hover:text-foreground disabled:opacity-40"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage(page + 1)}
              disabled={page >= maxPage}
              className="rounded border border-border px-3 py-1 text-sm text-muted hover:text-foreground disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
