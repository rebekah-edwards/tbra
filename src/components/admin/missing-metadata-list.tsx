"use client";

import { useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { saveBookLength } from "@/lib/actions/book-metadata";
import { setAudioLength, setPageCount } from "@/lib/actions/custom-goals";
import { NoCover } from "@/components/no-cover";
import type { MissingBookMetadata, MissingMetaBook, MissingQueueBook } from "@/lib/queries/missing-book-metadata";

// Inline fixer for missing pages & audio lengths: one row per book, the number
// typed right in the row (no trip to the book page).
//  • mode "catalog" (admins): saveBookLength writes the BOOK row (everyone's
//    totals) and bumps updated_at so the fix rides the live↔local sync.
//  • mode "personal" (Based Readers): the value counts for that reader's own
//    goals only (user_page_counts / user_audio_lengths) and shows up in the
//    admin queue as a suggestion.

type Mode = "catalog" | "personal";

export function MissingMetadataList({
  missing,
  focus,
  mode = "catalog",
}: {
  missing: MissingBookMetadata;
  focus: "pages" | "audio";
  mode?: Mode;
}) {
  const sections = focus === "audio" ? (["audio", "pages"] as const) : (["pages", "audio"] as const);
  return (
    <div className="space-y-7">
      {sections.map((kind) => (
        <Section key={kind} kind={kind} books={missing[kind]} mode={mode} />
      ))}
    </div>
  );
}

function Section({ kind, books, mode }: { kind: "pages" | "audio"; books: MissingMetaBook[]; mode: Mode }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  const own = (b: MissingMetaBook) => (kind === "pages" ? b.ownPages : b.ownMinutes);
  const left = books.filter((b) => !done.has(b.bookId) && !(mode === "personal" && own(b))).length;
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="section-heading text-sm">{kind === "pages" ? "No page count" : "No audio length"}</h2>
        <span className="text-xs text-muted">{left} left</span>
      </div>
      {books.length === 0 ? (
        <div className="rounded-[18px] border border-dashed border-foreground/15 bg-surface/40 p-5 text-center text-sm text-muted">
          {kind === "pages" ? "Every print and ebook read has a page count." : "Every audiobook read has a length."}
        </div>
      ) : (
        <div className="space-y-2.5">
          {books.map((b) => (
            <Row key={b.bookId} kind={kind} book={b} mode={mode} saved={done.has(b.bookId)}
              refreshOnSave={mode === "catalog"}
              onSaved={() => setDone((d) => new Set(d).add(b.bookId))} />
          ))}
        </div>
      )}
    </section>
  );
}

function Row({
  kind,
  book,
  saved,
  onSaved,
  refreshOnSave = true,
  mode = "catalog",
}: {
  kind: "pages" | "audio";
  book: Pick<MissingMetaBook, "bookId" | "title" | "slug" | "coverImageUrl" | "authors"> & {
    ownMinutes?: number | null;
    ownPages?: number | null;
    readers?: number;
    suggestion?: { value: number; count: number } | null;
  };
  mode?: Mode;
  saved: boolean;
  onSaved: () => void;
  /** The all-readers queue keeps the row (as "Saved") instead of reloading. */
  refreshOnSave?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [pages, setPages] = useState(book.ownPages ? String(book.ownPages) : "");
  const [h, setH] = useState(book.ownMinutes ? String(Math.floor(book.ownMinutes / 60)) : "");
  const [m, setM] = useState(book.ownMinutes ? String(book.ownMinutes % 60) : "");
  const hasOwn = mode === "personal" && Boolean(kind === "pages" ? book.ownPages : book.ownMinutes);

  function useSuggestion() {
    if (!book.suggestion) return;
    if (kind === "pages") setPages(String(book.suggestion.value));
    else {
      setH(String(Math.floor(book.suggestion.value / 60)));
      setM(String(book.suggestion.value % 60));
    }
  }
  const [error, setError] = useState("");

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const fields =
      kind === "pages"
        ? { pages: parseInt(pages, 10) }
        : { audioLengthMinutes: (parseInt(h || "0", 10) || 0) * 60 + (parseInt(m || "0", 10) || 0) };
    const value = kind === "pages" ? fields.pages : fields.audioLengthMinutes;
    if (!value || value < 1 || value > (kind === "pages" ? 20000 : 200 * 60)) {
      setError(kind === "pages" ? "Pages must be 1–20,000." : "Length must be 1 minute to 200 hours.");
      return;
    }
    start(async () => {
      const r =
        mode === "catalog"
          ? await saveBookLength(book.bookId, fields)
          : kind === "pages"
            ? await setPageCount(book.bookId, value)
            : await setAudioLength(book.bookId, value);
      if (!r.success) {
        setError(r.error ?? "Could not save.");
        return;
      }
      onSaved();
      if (refreshOnSave) router.refresh();
    });
  }

  return (
    <form onSubmit={save} className={`flex items-center gap-3 rounded-[18px] border border-foreground/10 bg-surface/60 p-3 backdrop-blur-md transition-opacity ${saved ? "opacity-60" : ""}`}>
      <Link href={`/book/${book.slug || book.bookId}`} className="flex-shrink-0">
        {book.coverImageUrl ? (
          <Image src={book.coverImageUrl} alt="" width={36} height={54} className="h-[54px] w-9 rounded-[4px] object-cover ring-1 ring-white/10" />
        ) : (
          <NoCover title={book.title} className="h-[54px] w-9" size="sm" />
        )}
      </Link>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold">{book.title}</p>
        {book.authors && <p className="truncate text-xs text-muted">{book.authors}</p>}
        {book.readers !== undefined && (
          <p className="mt-0.5 inline-flex items-center gap-1 text-[11px] text-muted">
            <span className="h-[5px] w-[5px] rounded-full bg-neon-blue" aria-hidden="true" />
            {book.readers} {book.readers === 1 ? "reader" : "readers"}
          </p>
        )}
        {book.suggestion && !saved && (
          <button type="button" onClick={useSuggestion}
            className="mt-1 inline-flex cursor-pointer items-center gap-1 rounded-full border border-foreground/10 bg-surface/80 px-2 py-0.5 text-[11px] font-semibold text-foreground">
            <span className="h-[5px] w-[5px] rounded-full bg-accent" aria-hidden="true" />
            {book.suggestion.count} {book.suggestion.count === 1 ? "reader suggests" : "readers suggest"}{" "}
            {kind === "pages"
              ? `${book.suggestion.value.toLocaleString("en-US")} pages`
              : `${Math.floor(book.suggestion.value / 60)}h ${book.suggestion.value % 60}m`}
            <span className="text-neon-blue">· Use</span>
          </button>
        )}
        {hasOwn && !saved && <p className="mt-0.5 text-[11px] text-muted">Your entry — counts for your goals</p>}
        {error && <p className="mt-0.5 text-xs text-destructive">{error}</p>}
      </div>
      {saved ? (
        <span className="inline-flex flex-shrink-0 items-center gap-1 text-xs font-semibold">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
          Saved
        </span>
      ) : (
        <div className="flex flex-shrink-0 items-center gap-1.5">
          {kind === "pages" ? (
            <input inputMode="numeric" value={pages} onChange={(e) => setPages(e.target.value.replace(/\D/g, "").slice(0, 5))}
              placeholder="pages" aria-label={`${book.title} pages`} className="field-glass !h-9 w-20 !px-2 text-center text-sm" />
          ) : (
            <>
              <input inputMode="numeric" value={h} onChange={(e) => setH(e.target.value.replace(/\D/g, "").slice(0, 3))}
                placeholder="h" aria-label={`${book.title} hours`} className="field-glass !h-9 w-12 !px-2 text-center text-sm" />
              <input inputMode="numeric" value={m} onChange={(e) => setM(e.target.value.replace(/\D/g, "").slice(0, 2))}
                placeholder="m" aria-label={`${book.title} minutes`} className="field-glass !h-9 w-12 !px-2 text-center text-sm" />
            </>
          )}
          <button type="submit" disabled={pending} className="btn-lime h-9 cursor-pointer px-3.5 text-xs">
            {pending ? "…" : "Save"}
          </button>
        </div>
      )}
    </form>
  );
}


/** All readers' queue: one kind at a time, rows stay in place as "Saved". */
export function MissingQueueList({ kind, books }: { kind: "pages" | "audio"; books: MissingQueueBook[] }) {
  const [done, setDone] = useState<Set<string>>(new Set());
  if (books.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-foreground/15 bg-surface/40 p-5 text-center text-sm text-muted">
        {kind === "pages" ? "No book anyone has read is missing a page count." : "No book anyone has listened to is missing a length."}
      </div>
    );
  }
  return (
    <div className="space-y-2.5">
      {books.map((b) => (
        <Row key={b.bookId} kind={kind} book={b} saved={done.has(b.bookId)} refreshOnSave={false}
          onSaved={() => setDone((d) => new Set(d).add(b.bookId))} />
      ))}
    </div>
  );
}
