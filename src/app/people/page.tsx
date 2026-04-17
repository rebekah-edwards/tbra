import type { Metadata } from "next";
import { PeopleSearchClient } from "./people-search-client";

export const metadata: Metadata = {
  title: "Find Readers | The Based Reader App",
  description: "Search for other readers on tbr*a by display name or @username.",
};

export default function PeoplePage() {
  return (
    <div className="mx-auto max-w-2xl">
      {/* Mobile pl-14 on heading + subtitle pushes text right of the fixed
          BackButton (left-4, w-10) without adding vertical space. */}
      <h1 className="text-foreground text-2xl font-bold tracking-tight pl-14 lg:pl-0">
        Find Readers
      </h1>
      <p className="mt-2 text-sm text-muted pl-14 lg:pl-0">
        Search by name or @username to follow other readers.
      </p>
      <PeopleSearchClient />
    </div>
  );
}
