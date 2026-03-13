export default function SearchPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Search</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">
        Find a book and see its content profile.
      </p>
      <div className="mt-6">
        <input
          type="text"
          placeholder="Search by title, author, or ISBN..."
          className="w-full rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm placeholder-zinc-400 focus:border-zinc-500 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:placeholder-zinc-500 dark:focus:border-zinc-500"
        />
      </div>
      <p className="mt-8 text-center text-sm text-zinc-400">
        Search backend coming in Phase 1.
      </p>
    </div>
  );
}
