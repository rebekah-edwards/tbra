import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { resolveBook } from "@/lib/queries/books";
import { getBookReadingNotes } from "@/lib/queries/reading-notes";
import { getCurrentUser } from "@/lib/auth";
import { BookNotesClient } from "./book-notes-client";

export default async function BookNotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const { id } = await params;
  const resolved = await resolveBook(id);
  if (!resolved) notFound();

  const book = resolved.book;
  const notes = await getBookReadingNotes(user.userId, book.id, 100);
  const bookUrl = `/book/${book.slug || book.id}`;

  return (
    <div className="lg:max-w-2xl">
      <Link
        href={bookUrl}
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors mb-4"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 18 9 12 15 6" />
        </svg>
        Back to {book.title}
      </Link>

      <h1 className="text-foreground text-2xl font-bold tracking-tight">
        Reading Notes
      </h1>
      <p className="mt-1 text-sm text-muted">
        {notes.length} {notes.length === 1 ? "note" : "notes"} for <span className="text-foreground font-medium">{book.title}</span>
      </p>

      <div className="mt-6">
        <BookNotesClient notes={notes} />
      </div>
    </div>
  );
}
