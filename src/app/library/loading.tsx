export default function LibraryLoading() {
  return (
    <div className="px-4 pb-24 pt-4 lg:max-w-[60%] lg:mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="skeleton h-7 w-32" />
        <div className="skeleton h-8 w-20 rounded-full" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {[80, 60, 70, 90, 50].map((w, i) => (
          <div key={i} className="skeleton h-8 rounded-full" style={{ width: w }} />
        ))}
      </div>

      {/* Book grid */}
      <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="skeleton aspect-[2/3] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
