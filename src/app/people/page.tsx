import type { Metadata } from "next";
import { PeopleSearchClient } from "./people-search-client";

export const metadata: Metadata = {
  title: "Find Readers | The Based Reader App",
  description: "Search for other readers on tbr*a by display name or @username.",
};

export default function PeoplePage() {
  return (
    <div className="mx-auto max-w-2xl pt-14 lg:pt-0">
      {/* Mobile pt-14 clears the fixed BackButton overlay (top ≈ 68px + 40px) */}
      <h1 className="text-foreground text-2xl font-bold tracking-tight">
        Find Readers
      </h1>
      <p className="mt-2 text-sm text-muted">
        Search by name or @username to follow other readers.
      </p>
      <PeopleSearchClient />
    </div>
  );
}
