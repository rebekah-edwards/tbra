import type { Metadata } from "next";
import { Suspense } from "react";
import { DiscoverClient } from "@/components/discover/discover-client";
import { PremiumGate } from "@/components/premium-gate";
import { getCurrentUser, isPremium } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Find Your Next Read | The Based Reader App",
  description: "Search by mood, genre, and reading preferences to find books you'll love on tbr*a.",
  alternates: { canonical: "https://thebasedreader.app/discover" },
  openGraph: {
    title: "Find Your Next Read | The Based Reader App",
    description: "Search by mood, genre, and reading preferences to find books you'll love on tbr*a.",
  },
};

export default async function FindPage() {
  // Find My Next Read is a Based Reader (premium) feature — free readers
  // and signed-out visitors see the standard upgrade prompt instead.
  // (The home page's "Discover Something New" strip stays free.)
  const user = await getCurrentUser();

  return (
    <div>
      <PremiumGate isPremium={isPremium(user)} featureName="Find My Next Read">
        <Suspense>
          <DiscoverClient />
        </Suspense>
      </PremiumGate>
    </div>
  );
}
