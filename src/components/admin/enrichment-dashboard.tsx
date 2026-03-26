"use client";

import { useState } from "react";

interface FailedBook {
  id: string;
  title: string;
  coverImageUrl: string | null;
  createdAt: string;
  status: string;
  errorMessage: string | null;
  failedAt: string;
}

interface NeverEnrichedBook {
  id: string;
  title: string;
  coverImageUrl: string | null;
  createdAt: string;
}

interface Props {
  failedBooks: FailedBook[];
  neverEnriched: NeverEnrichedBook[];
}

export function EnrichmentDashboardClient({ failedBooks, neverEnriched }: Props) {
  const [enriching, setEnriching] = useState<Set<string>>(new Set());
  const [completed, setCompleted] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bulkRunning, setBulkRunning] = useState(false);

  async function triggerEnrich(bookId: string) {
    setEnriching((prev) => new Set([...prev, bookId]));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[bookId];
      return next;
    });

    try {
      const res = await fetch("/api/enrichment/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookId }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setCompleted((prev) => new Set([...prev, bookId]));
      } else {
        setErrors((prev) => ({ ...prev, [bookId]: data.error || "Failed" }));
      }
    } catch {
      setErrors((prev) => ({ ...prev, [bookId]: "Network error" }));
    } finally {
      setEnriching((prev) => {
        const next = new Set(prev);
        next.delete(bookId);
        return next;
      });
    }
  }

  async function bulkReEnrich(bookIds: string[]) {
    setBulkRunning(true);
    for (const id of bookIds) {
      if (completed.has(id)) continue;
      await triggerEnrich(id);
      // Small delay between requests to avoid hammering APIs
      await new Promise((r) => setTimeout(r, 2000));
    }
    setBulkRunning(false);
  }

  const allFailedIds = failedBooks.map((b) => b.id);
  const allNeverIds = neverEnriched.map((b) => b.id);

  return (
    <div className="space-y-8">
      {/* Failed Enrichment Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Failed Enrichment
            <span className="ml-2 text-sm text-muted font-normal">({failedBooks.length})</span>
          </h2>
          {failedBooks.length > 0 && (
            <button
              onClick={() => bulkReEnrich(allFailedIds)}
              disabled={bulkRunning}
              className="text-sm px-3 py-1.5 rounded-lg bg-accent text-black font-medium hover:bg-accent/80 disabled:opacity-50 transition-colors"
            >
              {bulkRunning ? "Running..." : "Re-enrich All Failed"}
            </button>
          )}
        </div>

        {failedBooks.length === 0 ? (
          <p className="text-sm text-muted">No failed enrichments.</p>
        ) : (
          <div className="space-y-2">
            {failedBooks.map((book) => (
              <BookRow
                key={book.id}
                id={book.id}
                title={book.title}
                coverImageUrl={book.coverImageUrl}
                subtitle={
                  <>
                    <span className={`text-xs font-medium ${book.status === "api_exhausted" ? "text-yellow-500" : "text-destructive"}`}>
                      {book.status === "api_exhausted" ? "API Exhausted" : "Failed"}
                    </span>
                    {book.errorMessage && (
                      <span className="text-xs text-muted ml-2 truncate max-w-[300px] inline-block align-bottom">
                        {book.errorMessage}
                      </span>
                    )}
                  </>
                }
                timestamp={book.failedAt}
                isEnriching={enriching.has(book.id)}
                isCompleted={completed.has(book.id)}
                error={errors[book.id]}
                onEnrich={() => triggerEnrich(book.id)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Never Enriched Section */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">
            Never Enriched
            <span className="ml-2 text-sm text-muted font-normal">({neverEnriched.length})</span>
          </h2>
          {neverEnriched.length > 0 && (
            <button
              onClick={() => bulkReEnrich(allNeverIds)}
              disabled={bulkRunning}
              className="text-sm px-3 py-1.5 rounded-lg bg-accent text-black font-medium hover:bg-accent/80 disabled:opacity-50 transition-colors"
            >
              {bulkRunning ? "Running..." : "Enrich All"}
            </button>
          )}
        </div>

        {neverEnriched.length === 0 ? (
          <p className="text-sm text-muted">All books have been enriched.</p>
        ) : (
          <div className="space-y-2">
            {neverEnriched.map((book) => (
              <BookRow
                key={book.id}
                id={book.id}
                title={book.title}
                coverImageUrl={book.coverImageUrl}
                subtitle={<span className="text-xs text-muted">Imported {new Date(book.createdAt).toLocaleDateString()}</span>}
                timestamp={book.createdAt}
                isEnriching={enriching.has(book.id)}
                isCompleted={completed.has(book.id)}
                error={errors[book.id]}
                onEnrich={() => triggerEnrich(book.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function BookRow({
  id,
  title,
  coverImageUrl,
  subtitle,
  timestamp,
  isEnriching,
  isCompleted,
  error,
  onEnrich,
}: {
  id: string;
  title: string;
  coverImageUrl: string | null;
  subtitle: React.ReactNode;
  timestamp: string;
  isEnriching: boolean;
  isCompleted: boolean;
  error?: string;
  onEnrich: () => void;
}) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-surface">
      {/* Cover */}
      <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-surface-alt">
        {coverImageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverImageUrl} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-muted">?</div>
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <a href={`/book/${id}`} className="text-sm font-medium text-foreground hover:text-link truncate block">
          {title}
        </a>
        <div className="mt-0.5">{subtitle}</div>
      </div>

      {/* Action */}
      <div className="flex-shrink-0">
        {isCompleted ? (
          <span className="text-xs text-green-500 font-medium">Done</span>
        ) : error ? (
          <div className="text-right">
            <span className="text-xs text-destructive block">{error}</span>
            <button onClick={onEnrich} className="text-xs text-link hover:underline mt-0.5">
              Retry
            </button>
          </div>
        ) : (
          <button
            onClick={onEnrich}
            disabled={isEnriching}
            className="text-sm px-3 py-1 rounded-lg border border-border text-foreground hover:bg-surface-alt disabled:opacity-50 transition-colors"
          >
            {isEnriching ? "Enriching..." : "Re-enrich"}
          </button>
        )}
      </div>
    </div>
  );
}
