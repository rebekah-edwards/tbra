import SearchClient from "./search-client";

export default function SearchPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Search</h1>
      <p className="mt-2 text-muted">
        Find a book and see its content profile.
      </p>
      <div className="mt-6">
        <SearchClient />
      </div>
    </div>
  );
}
