import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getRecentNotes } from "@/lib/queries/reading-notes";
import { JournalNoteCard } from "@/components/profile/journal-note-card";

export default async function JournalPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const notes = await getRecentNotes(session.userId, 100);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/profile" className="text-muted hover:text-foreground transition-colors">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <h1
          className="text-foreground text-xl font-bold tracking-tight"
         
        >
          Reading Journal
        </h1>
        <span className="text-sm text-muted">({notes.length})</span>
      </div>

      {/* Notes list */}
      <div className="space-y-3">
        {notes.map((note) => (
          <JournalNoteCard key={note.id} note={note} />
        ))}
      </div>

      {notes.length === 0 && (
        <p className="text-center text-sm text-muted py-8">No journal entries yet.</p>
      )}
    </div>
  );
}
