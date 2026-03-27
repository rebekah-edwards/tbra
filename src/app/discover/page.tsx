import type { Metadata } from "next";
import { Suspense } from "react";
import { DiscoverClient } from "@/components/discover/discover-client";

export const metadata: Metadata = {
  title: "Find Your Next Read | The Based Reader App",
  description: "Search by mood, genre, and reading preferences to find books you'll love on tbr*a.",
  openGraph: {
    title: "Find Your Next Read | The Based Reader App",
    description: "Search by mood, genre, and reading preferences to find books you'll love on tbr*a.",
  },
};

export default function FindPage() {
  return (
    <div>
      <Suspense>
        <DiscoverClient />
      </Suspense>
    </div>
  );
}
