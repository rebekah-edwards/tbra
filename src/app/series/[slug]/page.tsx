import type { Metadata } from "next";
export const revalidate = 60;
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getSeriesBooksBySlug, resolveSeries, getSeriesBooks, getChildSeries } from "@/lib/queries/books";
import { SeriesBooksView } from "@/app/search/series-books-view";
import { FranchiseSeriesGrid } from "@/components/series/franchise-series-grid";

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

  // Fetch series name + child series in parallel (not sequentially)
  let seriesName = "name" in resolved.series ? resolved.series.name : "";
  const [seriesData, childSeries] = await Promise.all([
    !seriesName ? getSeriesBooks(resolved.series.id, null) : null,
    getChildSeries(resolved.series.id),
  ]);
  if (!seriesName) seriesName = seriesData?.name ?? "Series";
  const isFranchise = childSeries.length > 0;

  const description = isFranchise
    ? `Explore all ${childSeries.length} series in the ${seriesName} franchise on tbr*a.`
    : `View every book in ${seriesName}, filter by Core or All books, and add them to your tbr*a shelf.`;

  return {
    title: `${seriesName} | The Based Reader App`,
    description,
    alternates: { canonical: canonicalUrl },
    openGraph: {
      title: `${seriesName} | The Based Reader App`,
      description,
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

  const seriesId = resolved.series.id;

  // Check if this is a franchise (has child series)
  const childSeries = await getChildSeries(seriesId);

  if (childSeries.length > 0) {
    // Franchise page — grid of sub-series
    let seriesName = "name" in resolved.series ? resolved.series.name : "";
    if (!seriesName) {
      const data = await getSeriesBooks(seriesId, null);
      seriesName = data?.name ?? "Series";
    }

    return (
      <div>
        <FranchiseSeriesGrid
          franchiseName={seriesName}
          franchiseId={seriesId}
          childSeries={childSeries}
          isAdmin={isAdmin(user)}
        />
      </div>
    );
  }

  // Regular series page — book list
  const seriesData = resolved.isIdLookup
    ? await getSeriesBooks(seriesId, user?.userId ?? null)
    : await getSeriesBooksBySlug(slug, user?.userId ?? null);

  if (!seriesData) {
    notFound();
  }

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
