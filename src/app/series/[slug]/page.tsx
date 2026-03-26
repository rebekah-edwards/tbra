import type { Metadata } from "next";
export const revalidate = 60;
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getSeriesBooksBySlug, resolveSeries, getSeriesBooks } from "@/lib/queries/books";
import { SeriesBooksView } from "@/app/search/series-books-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const resolved = await resolveSeries(slug);
  if (!resolved) return { title: "Series Not Found | tbr*a" };

  const seriesSlug = resolved.series.slug || slug;
  const canonicalUrl = `https://thebasedreader.app/series/${seriesSlug}`;

  // We need the series name — for UUID lookups, get from the data
  let seriesName = "name" in resolved.series ? resolved.series.name : "";
  if (!seriesName) {
    const data = await getSeriesBooks(resolved.series.id, null);
    seriesName = data?.name ?? "Series";
  }

  return {
    title: `${seriesName} | The Based Reader App`,
    description: `View every book in ${seriesName}, filter by Core or All books, and add them to your tbr*a shelf.`,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${seriesName} | The Based Reader App`,
      description: `View every book in ${seriesName}, filter by Core or All books, and add them to your tbr*a shelf.`,
      url: canonicalUrl,
    },
  };
}

export default async function SeriesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getCurrentUser();

  // Try to resolve as UUID first (for old /search?series=UUID redirects)
  const resolved = await resolveSeries(slug);
  if (!resolved) {
    notFound();
  }

  // If accessed by UUID and series has a slug, redirect to canonical URL
  if (resolved.isIdLookup && resolved.series.slug) {
    redirect(`/series/${resolved.series.slug}`);
  }

  // Get series data by slug
  const seriesData = resolved.isIdLookup
    ? await getSeriesBooks(resolved.series.id, user?.userId ?? null)
    : await getSeriesBooksBySlug(slug, user?.userId ?? null);

  if (!seriesData) {
    notFound();
  }

  const seriesId = resolved.series.id;

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
