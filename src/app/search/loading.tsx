export default function SearchLoading() {
  return (
    <div className="px-4 pb-24 pt-4 lg:max-w-[60%] lg:mx-auto">
      {/* Heading */}
      <div className="skeleton h-7 w-32 mb-2" />
      <div className="skeleton h-4 w-56 mb-6" />

      {/* Search bar */}
      <div className="skeleton h-12 w-full rounded-xl mb-8" />

      {/* Result rows */}
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-center">
            <div className="skeleton w-12 aspect-[2/3] rounded-md flex-shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-3 w-1/2" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
