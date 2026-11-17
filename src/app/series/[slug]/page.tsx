import type { Metadata } from "next";
export const revalidate = 60;
import { notFound, redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { getSeriesBooksBySlug, resolveSeries, getSeriesBooks, getChildSeries } from "@/lib/queries/books";
import { SeriesBooksView } from "@/app/search/series-books-view";
import { FranchiseSeriesGrid } from "@/components/series/franchise-series-grid";
import { isSeriesIndexable, NOINDEX_FOLLOW } from "@/lib/seo/indexability";

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

  // Indexable only once the series lists enough core books — thin series
  // pages were being filed by Google as soft 404s.
  const indexable = await isSeriesIndexable(resolved.series.id);

  return {
    title: `${seriesName} | The Based Reader App`,
    description,
    alternates: { canonical: canonicalUrl },
    ...(indexable ? {} : { robots: NOINDEX_FOLLOW }),
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

  // A series can have child series (franchise) AND its own books. Fetch both:
  // a parent's own books must never disappear just because a sub-series was
  // attached to it (2026-11-16 — attaching Megamorphs to Animorphs replaced
  // the 52-book list with a one-card franchise grid).
  const [childSeries, seriesData] = await Promise.all([
    getChildSeries(seriesId),
    resolved.isIdLookup
      ? getSeriesBooks(seriesId, user?.userId ?? null)
      : getSeriesBooksBySlug(slug, user?.userId ?? null),
  ]);
  const hasOwnBooks = (seriesData?.books.length ?? 0) > 0;

  if (childSeries.length > 0 && !hasOwnBooks) {
    // Pure franchise container — grid of sub-series only
    const seriesName =
      ("name" in resolved.series ? resolved.series.name : "") || seriesData?.name || "Series";

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

  // Series page — book list (with the sub-series grid on top when it has any)
  if (!seriesData) {
    notFound();
  }

  return (
    // One readable column on desktop — the rows stretched the full 1194px.
    <div className="lg:mx-auto lg:max-w-3xl">
      <SeriesBooksView
        seriesName={seriesData.name}
        seriesId={seriesId}
        books={seriesData.books}
        isLoggedIn={!!user}
        isAdmin={isAdmin(user)}
        canReport={!!user && ["beta_tester", "admin", "super_admin"].includes(user.accountType)}
        coverStyle={seriesData.coverStyle}
        subSeries={
          childSeries.length > 0 ? (
            <FranchiseSeriesGrid
              franchiseName={seriesData.name}
              franchiseId={seriesId}
              childSeries={childSeries}
              isAdmin={isAdmin(user)}
              embedded
            />
          ) : undefined
        }
      />
    </div>
  );
}
