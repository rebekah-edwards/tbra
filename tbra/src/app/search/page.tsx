import { getCurrentUser } from "@/lib/auth";
import { getSeriesBooks } from "@/lib/queries/books";
import SearchClient from "./search-client";
import { SeriesBooksView } from "./series-books-view";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const seriesId = params.series;

  // If filtering by series, show series books from our DB
  if (seriesId) {
    const seriesData = await getSeriesBooks(seriesId, user?.userId ?? null);
    if (seriesData) {
      return (
        <div>
          <SeriesBooksView
            seriesName={seriesData.name}
            books={seriesData.books}
            isLoggedIn={!!user}
          />
        </div>
      );
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Search</h1>
      <p className="mt-2 text-muted">
        Find a book and see what&apos;s inside.
      </p>
      <div className="mt-6">
        <SearchClient isLoggedIn={!!user} />
      </div>
    </div>
  );
}
