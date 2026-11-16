"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveManualDescription } from "@/lib/actions/descriptions";
import type {
  DescriptionQueueBook,
  DescriptionQueueTab,
} from "@/lib/queries/description-queue";

type Props = {
  books: DescriptionQueueBook[];
  counts: Record<DescriptionQueueTab, number>;
  activeTab: DescriptionQueueTab;
  page: number;
  pageSize: number;
};

const TABS: { key: DescriptionQueueTab; label: string; hint: string }[] = [
  { key: "active", label: "Has reader activity", hint: "On a shelf, being read, rated or reviewed" },
  { key: "all", label: "All", hint: "Every public book that needs a description" },
];

/** sanitizeDescription() rejects anything shorter than this. */
const MIN_CHARS = 60;
/** Below this, enrichment treats a description as a stub and may replace it
 *  with a longer one from ISBNdb / Google Books (THIN_DESCRIPTION_CHARS in
 *  src/lib/enrichment/enrich-book.ts). */
const THIN_CHARS = 180;

function queueHref(tab: DescriptionQueueTab, page: number) {
  return `/admin/descriptions?tab=${tab}${page > 1 ? `&page=${page}` : ""}`;
}

function plural(n: number, word: string) {
  return `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
}

function activityBreakdown(book: DescriptionQueueBook) {
  const parts: string[] = [];
  if (book.shelved > 0) parts.push(`${book.shelved.toLocaleString()} shelved`);
  if (book.sessions > 0) parts.push(plural(book.sessions, "read"));
  if (book.ratings > 0) parts.push(plural(book.ratings, "rating"));
  if (book.reviews > 0) parts.push(plural(book.reviews, "review"));
  return parts.join(" · ");
}

function QueueRow({
  book,
  onDone,
}: {
  book: DescriptionQueueBook;
  onDone: (bookId: string, message: string) => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const length = text.trim().length;
  const authors = book.authorNames.join(", ");
  const searchHref = `https://www.google.com/search?q=${encodeURIComponent(
    [book.title, book.authorNames[0], "book description"].filter(Boolean).join(" "),
  )}`;

  function handleSave() {
    if (isPending || length === 0) return;
    setError(null);
    startTransition(async () => {
      try {
        const res = await saveManualDescription(book.id, text);
        if (res.success) {
          const trimmedNote =
            res.savedLength < res.inputLength
              ? ` The filter trimmed it from ${res.inputLength.toLocaleString()} to ${res.savedLength.toLocaleString()} characters (links, review quotes and author-bio text are removed).`
              : "";
          onDone(book.id, `Saved “${book.title}”.${trimmedNote}`);
          return;
        }
        if (res.gone) {
          onDone(book.id, `“${book.title}”: ${res.error}`);
          return;
        }
        setError(res.error);
      } catch {
        setError("Save failed — check your connection and try again.");
      }
    });
  }

  let lengthHint = "Paste the publisher’s description.";
  if (length > 0 && length < MIN_CHARS) {
    lengthHint = `${length} characters — minimum is ${MIN_CHARS}.`;
  } else if (length >= MIN_CHARS && length < THIN_CHARS) {
    lengthHint = `${length} characters — short. Under ${THIN_CHARS}, enrichment may later swap in a longer description it finds.`;
  } else if (length >= THIN_CHARS) {
    lengthHint = `${length.toLocaleString()} characters`;
  }

  return (
    <article className="rounded-lg border border-border bg-surface p-3 sm:p-4">
      <div className="flex gap-3 sm:gap-4">
        {/* Cover thumbnail */}
        <div className="shrink-0 w-12 h-[72px] sm:w-16 sm:h-24 rounded bg-surface-alt border border-border flex items-center justify-center overflow-hidden">
          {book.coverImageUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={book.coverImageUrl}
              alt=""
              loading="lazy"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-[9px] text-muted text-center px-1">no cover</span>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <h2 className="text-sm sm:text-base font-semibold text-foreground line-clamp-2 break-words">
            {book.title}
          </h2>
          <p className="text-xs text-muted mt-0.5 line-clamp-2 break-words">
            {authors || "— no author —"}
            {book.publicationYear ? ` · ${book.publicationYear}` : ""}
          </p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            {book.readers > 0 ? (
              <span
                className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-semibold text-accent"
                title="Distinct readers with this book shelved, owned, read, rated or reviewed"
              >
                {plural(book.readers, "reader")}
              </span>
            ) : (
              <span className="rounded-full border border-border bg-surface-alt px-2 py-0.5 text-[11px] text-muted">
                No reader activity
              </span>
            )}
            {book.readers > 0 && (
              <span className="text-[11px] text-muted">{activityBreakdown(book)}</span>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {book.slug ? (
              <Link
                href={`/book/${book.slug}`}
                target="_blank"
                className="text-neon-blue hover:underline"
              >
                Book page
              </Link>
            ) : (
              <span className="text-muted/60">No public page yet</span>
            )}
            <a
              href={searchHref}
              target="_blank"
              rel="noopener noreferrer"
              className="text-neon-blue hover:underline"
            >
              Search for a description
            </a>
          </div>
        </div>
      </div>

      {book.staleDescription && (
        <details className="mt-3 rounded border border-border bg-surface-alt px-3 py-2">
          <summary className="cursor-pointer text-xs text-muted">
            Current description — flagged for replacement (
            {book.staleDescription.length.toLocaleString()} characters)
          </summary>
          <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-line break-words text-xs text-foreground">
            {book.staleDescription}
          </p>
        </details>
      )}

      <label className="sr-only" htmlFor={`desc-${book.id}`}>
        Description for {book.title}
      </label>
      <textarea
        id={`desc-${book.id}`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleSave();
          }
        }}
        rows={5}
        disabled={isPending}
        placeholder="Paste the publisher’s description…"
        className="mt-3 block w-full resize-y rounded border border-border bg-surface-alt px-3 py-2 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none disabled:opacity-60"
      />

      <div className="mt-2 flex items-start justify-between gap-3">
        <p className="min-w-0 flex-1 text-[11px] text-muted">{lengthHint}</p>
        <button
          type="button"
          onClick={handleSave}
          disabled={isPending || length === 0}
          className="shrink-0 rounded bg-accent px-4 py-2 text-sm font-semibold text-[#18181b] disabled:opacity-40"
        >
          {isPending ? "Saving…" : "Save"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}

export function DescriptionsQueue({ books, counts, activeTab, page, pageSize }: Props) {
  // Rows that have been saved (or turned out to be filled already). The save
  // action re-renders this page server-side, so the fresh `books` prop normally
  // no longer contains them — this set just guarantees a saved row is gone
  // immediately, and stays gone even if that refresh is slow or fails.
  const [done, setDone] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<string | null>(null);
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();

  function handleDone(bookId: string, message: string) {
    setDone((prev) => new Set(prev).add(bookId));
    setStatus(message);
  }

  const visible = books.filter((b) => !done.has(b.id));
  // Server counts already exclude saved rows once the refresh lands; until
  // then, subtract the ones still present in the stale prop.
  const pendingRemoval = books.length - visible.length;
  const total = Math.max(0, counts[activeTab] - pendingRemoval);
  const maxPage = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = (page - 1) * pageSize + 1;
  const lastRow = Math.min((page - 1) * pageSize + visible.length, total);

  return (
    <div className="space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => {
          const count = Math.max(0, counts[t.key] - (t.key === activeTab ? pendingRemoval : 0));
          const isActive = activeTab === t.key;
          return (
            <Link
              key={t.key}
              href={queueHref(t.key, 1)}
              title={t.hint}
              aria-current={isActive ? "page" : undefined}
              className={`relative shrink-0 whitespace-nowrap px-3 py-2 text-sm transition-colors ${
                isActive ? "text-foreground font-semibold" : "text-muted hover:text-foreground"
              }`}
            >
              {t.label}
              <span className="ml-1.5 text-xs text-muted/70">({count.toLocaleString()})</span>
              {isActive && (
                <span className="absolute left-3 right-3 -bottom-px h-[2px] rounded-full bg-accent" />
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-foreground">
          <span className="font-semibold">{total.toLocaleString()}</span>{" "}
          <span className="text-muted">
            {total === 1 ? "book" : "books"}
            {activeTab === "active" ? " with reader activity" : ""}{" "}
            {total === 1 ? "needs" : "need"} a description
          </span>
        </p>
        <p className="text-[11px] text-muted">Ctrl/⌘ + Enter saves the box you’re typing in.</p>
      </div>

      <p aria-live="polite" className={status ? "rounded border border-border bg-surface-alt px-3 py-2 text-xs text-foreground" : "sr-only"}>
        {status ?? ""}
      </p>

      {/* List */}
      {visible.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface p-8 text-center text-sm text-muted">
          {total === 0 ? (
            "Nothing waiting in this tab."
          ) : (
            <>
              This page is done.{" "}
              <button
                type="button"
                onClick={() => startRefresh(() => router.refresh())}
                disabled={isRefreshing}
                className="text-neon-blue hover:underline disabled:opacity-40"
              >
                {isRefreshing ? "Loading…" : "Load the next books"}
              </button>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((b) => (
            <QueueRow key={b.id} book={b} onDone={handleDone} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {(total > pageSize || page > 1) && visible.length > 0 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-xs text-muted">
            Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {total.toLocaleString()}
          </span>
          <div className="flex gap-2">
            <PageLink href={queueHref(activeTab, page - 1)} disabled={page <= 1}>
              Previous
            </PageLink>
            <PageLink href={queueHref(activeTab, page + 1)} disabled={page >= maxPage}>
              Next
            </PageLink>
          </div>
        </div>
      )}
    </div>
  );
}

function PageLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  const base = "rounded border border-border px-3 py-1.5 text-sm";
  if (disabled) {
    return (
      <span aria-disabled="true" className={`${base} text-muted opacity-40`}>
        {children}
      </span>
    );
  }
  return (
    <Link href={href} className={`${base} text-neon-blue hover:border-muted`}>
      {children}
    </Link>
  );
}
