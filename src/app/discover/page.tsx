import type { Metadata } from "next";
import { Suspense } from "react";
import { DiscoverClient } from "@/components/discover/discover-client";
import { PremiumGate } from "@/components/premium-gate";
import { getCurrentUser, isPremium } from "@/lib/auth";
import { getDiscoverRemaining } from "@/lib/discover-quota";

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
  // Find My Next Read: Based Reader = unlimited; FREE accounts get 3
  // searches/month (2026-07-15) — so everyone signed-in gets the page,
  // with a meter for free readers. Signed-out visitors still see the gate.
  const user = await getCurrentUser();
  const premium = isPremium(user);
  const initialRemaining = !user || premium ? null : await getDiscoverRemaining(user.userId);

  return (
    <div>
      {user ? (
        <Suspense>
          <DiscoverClient isPremium={premium} initialRemaining={initialRemaining} />
        </Suspense>
      ) : (
        <PremiumGate isPremium={false} featureName="Find My Next Read">
          <div />
        </PremiumGate>
      )}
    </div>
  );
}
