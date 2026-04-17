import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getSeriesBooks, resolveSeries } from "@/lib/queries/books";
import { SeriesBooksView } from "./series-books-view";
import SearchClient from "./search-client";

export const metadata = {
  robots: { index: false },
};

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ series?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  const params = await searchParams;
  const seriesId = params.series;
  const initialQuery = params.q;

  // If filtering by series, redirect to the new /series/[slug] canonical URL
  if (seriesId) {
    const resolved = await resolveSeries(seriesId);
    if (resolved?.series.slug) {
      redirect(`/series/${resolved.series.slug}`);
    }

    // Fallback: render inline if no slug yet
    const seriesData = await getSeriesBooks(seriesId, user?.userId ?? null);
    if (seriesData) {
      return (
        <div>
          <SeriesBooksView
            seriesName={seriesData.name}
            seriesId={seriesId}
            books={seriesData.books}
            isLoggedIn={!!user}
            isAdmin={isAdmin(user)}
            canReport={!!user && ["beta_tester", "admin", "super_admin"].includes(user.accountType)}
            coverStyle={seriesData.coverStyle}
          />
        </div>
      );
    }
  }

  return (
    <div className="pt-14 lg:pt-0">
      {/* Mobile pt-14 clears the fixed BackButton overlay (top ≈ 68px + 40px) */}
      <h1 className="text-foreground text-2xl font-bold tracking-tight">Search</h1>
      <p className="mt-2 text-muted">
        Search for books by title, author, or series.
      </p>
      <div className="mt-6">
        <SearchClient isLoggedIn={!!user} initialQuery={initialQuery} />
      </div>
    </div>
  );
}
