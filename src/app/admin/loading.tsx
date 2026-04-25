/**
 * Suspense fallback for every nested /admin route. Several pages — Review
 * Queue, Cover Review, Enrichment, Landing — load tens of thousands of
 * rows and can take 5-30+ seconds to render on a cold function. Without a
 * loading state, the navigation looked like "nothing happens" and users
 * tapped repeatedly thinking the click was missed.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-6 lg:w-[60%] lg:mx-auto pb-24 lg:pb-8">
      <div>
        <div className="h-7 w-32 rounded bg-surface-alt animate-pulse" />
        <div className="mt-2 h-4 w-64 rounded bg-surface-alt/60 animate-pulse" />
      </div>

      <div className="flex items-center gap-3 text-sm text-muted">
        <svg
          className="h-4 w-4 animate-spin text-accent"
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
        >
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
        Loading admin data… large queries can take 30+ seconds on a cold start.
      </div>

      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-20 rounded-xl border border-border bg-surface-alt/40 animate-pulse"
          />
        ))}
      </div>
    </div>
  );
}
