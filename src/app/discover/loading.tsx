export default function DiscoverLoading() {
  return (
    <div className="px-4 pb-24 pt-4 lg:max-w-[60%] lg:mx-auto">
      {/* Header */}
      <div className="skeleton h-8 w-48 mb-2" />
      <div className="skeleton h-4 w-64 mb-6" />

      {/* Search bar */}
      <div className="skeleton h-12 w-full rounded-xl mb-6" />

      {/* Mood cards grid */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton h-24 rounded-xl" />
        ))}
      </div>

      {/* Recommendation section */}
      <div className="skeleton h-6 w-36 mb-3" />
      <div className="flex gap-3 overflow-hidden">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[2/3] w-[130px] flex-shrink-0 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
