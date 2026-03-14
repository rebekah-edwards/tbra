import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUserBooks } from "@/lib/queries/reading-state";
import { BookCard } from "@/components/book-card";

function EmptySection({ message }: { message: string }) {
  return (
    <p className="text-sm text-muted">
      {message}{" "}
      <Link href="/search" className="text-primary hover:text-primary-dark">
        Find books
      </Link>
    </p>
  );
}

function HorizontalScroll({
  books,
}: {
  books: { id: string; title: string; coverImageUrl: string | null; authors: string[]; isFiction?: boolean | null }[];
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2 -mx-2 px-2">
      {books.map((book) => (
        <div key={book.id} className="w-[150px] flex-shrink-0">
          <BookCard {...book} />
        </div>
      ))}
    </div>
  );
}

export default async function Home() {
  const user = await getCurrentUser();

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <h1 className="neon-heading text-4xl font-bold tracking-tight">
          Welcome to tbr(a)
        </h1>
        <p className="mt-4 max-w-md text-lg text-muted">
          Detailed, structured content information for books. Know what&apos;s in
          a book before you read it.
        </p>
      </div>
    );
  }

  const allBooks = await getUserBooks(user.userId);

  const currentlyReading = allBooks.filter(
    (b) => b.state === "currently_reading"
  );
  const tbr = allBooks.filter((b) => b.state === "tbr");
  const completed = allBooks
    .filter((b) => b.state === "completed")
    .slice(0, 5);

  return (
    <div className="space-y-10">
      <section>
        <h2
          className="text-xl font-bold tracking-tight mb-4"
          style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}
        >
          Currently Reading
        </h2>
        {currentlyReading.length > 0 ? (
          <HorizontalScroll books={currentlyReading} />
        ) : (
          <EmptySection message="Nothing here yet." />
        )}
      </section>

      <section>
        <h2
          className="text-xl font-bold tracking-tight mb-4"
          style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}
        >
          Your TBR
        </h2>
        {tbr.length > 0 ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
            {tbr.map((book) => (
              <BookCard key={book.id} {...book} />
            ))}
          </div>
        ) : (
          <EmptySection message="Your TBR is empty." />
        )}
      </section>

      <section>
        <h2
          className="text-xl font-bold tracking-tight mb-4"
          style={{ fontFamily: "var(--font-heading), system-ui, sans-serif" }}
        >
          Recently Completed
        </h2>
        {completed.length > 0 ? (
          <HorizontalScroll books={completed} />
        ) : (
          <EmptySection message="No completed books yet." />
        )}
      </section>
    </div>
  );
}
