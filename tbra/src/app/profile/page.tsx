import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUser, getUserStats } from "@/lib/queries/profile";
import { getUserBooks } from "@/lib/queries/reading-state";
import { BookCard } from "@/components/book-card";

function StatCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-surface-alt px-4 py-3">
      <span className="text-2xl font-bold" style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}>
        {count}
      </span>
      <span className="text-xs text-muted">{label}</span>
    </div>
  );
}

function BookSection({
  title,
  books,
  emptyMessage,
}: {
  title: string;
  books: { id: string; title: string; coverImageUrl: string | null; authors: string[]; isFiction?: boolean | null; userRating?: number | null }[];
  emptyMessage: string;
}) {
  return (
    <section>
      <h2
        className="text-lg font-bold tracking-tight mb-3"
        style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}
      >
        {title}
      </h2>
      {books.length > 0 ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {books.map((book) => (
            <BookCard key={book.id} {...book} />
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted">
          {emptyMessage}{" "}
          <Link href="/search" className="text-primary hover:text-primary-dark">
            Find books
          </Link>
        </p>
      )}
    </section>
  );
}

export default async function ProfilePage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const user = await getUser(session.userId);
  if (!user) redirect("/login");

  const stats = await getUserStats(session.userId);
  const allBooks = await getUserBooks(session.userId);

  const currentlyReading = allBooks.filter((b) => b.state === "currently_reading");
  const tbr = allBooks.filter((b) => b.state === "tbr");
  const completed = allBooks.filter((b) => b.state === "completed").slice(0, 8);
  const owned = allBooks.filter((b) => b.ownedFormats.length > 0);

  const memberSince = new Date(user.createdAt).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="space-y-8">
      {/* Profile Header */}
      <div className="flex items-center gap-5">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary text-3xl font-bold text-background overflow-hidden flex-shrink-0">
          {user.avatarUrl ? (
            <img src={user.avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
          ) : (
            (user.displayName || user.email)[0].toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">
            {user.displayName || user.email.split("@")[0]}
          </h1>
          <p className="text-sm text-muted truncate">{user.email}</p>
          <p className="text-xs text-muted mt-0.5">Member since {memberSince}</p>
          <Link
            href="/profile/edit"
            className="mt-1 inline-block text-sm text-primary hover:text-primary-dark"
          >
            Edit Profile
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard label="Read" count={stats.completed} />
        <StatCard label="Reading" count={stats.currentlyReading} />
        <StatCard label="TBR" count={stats.tbr} />
        <StatCard label="Owned" count={stats.owned} />
      </div>

      {/* Book Sections */}
      <BookSection
        title="Currently Reading"
        books={currentlyReading}
        emptyMessage="Nothing here yet."
      />

      <BookSection
        title="Your TBR"
        books={tbr}
        emptyMessage="Your TBR is empty."
      />

      <BookSection
        title="Recently Completed"
        books={completed}
        emptyMessage="No completed books yet."
      />

      <BookSection
        title="Owned Library"
        books={owned}
        emptyMessage="No owned books yet."
      />
    </div>
  );
}
