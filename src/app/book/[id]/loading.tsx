export default function BookLoading() {
  return (
    <div className="pb-24 pt-4">
      {/* Hero card skeleton */}
      <div className="relative rounded-2xl overflow-hidden p-5">
        <div className="flex gap-4">
          {/* Cover */}
          <div className="skeleton aspect-[2/3] w-[140px] rounded-lg flex-shrink-0" />
          {/* Title + author + meta */}
          <div className="flex-1 space-y-3 pt-2">
            <div className="skeleton h-6 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-4 w-1/3" />
            <div className="flex gap-2 mt-2">
              <div className="skeleton h-6 w-16 rounded-full" />
              <div className="skeleton h-6 w-20 rounded-full" />
            </div>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="mt-6 space-y-3 px-4">
        <div className="flex gap-3">
          <div className="skeleton h-11 flex-1 rounded-xl" />
          <div className="skeleton h-11 w-11 rounded-xl" />
        </div>
        <div className="flex gap-3">
          <div className="skeleton h-11 flex-1 rounded-xl" />
          <div className="skeleton h-11 flex-1 rounded-xl" />
        </div>
      </div>

      {/* About section */}
      <div className="mt-8 px-4 space-y-3">
        <div className="skeleton h-5 w-16" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-3/4" />
      </div>

      {/* Content details section */}
      <div className="mt-8 px-4 space-y-3">
        <div className="skeleton h-5 w-28" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between">
              <div className="skeleton h-4 w-24" />
              <div className="skeleton h-4 w-16" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
