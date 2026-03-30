import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getUserBooks } from "@/lib/queries/reading-state";
import { getUserContentSensitivities } from "@/lib/queries/reading-preferences";
import { LibraryClient } from "./library-client";

export const metadata: Metadata = {
  title: "My Library | The Based Reader App",
  description: "View your to-be-read list (TBR), owned library, and completed books on tbr*a.",
  robots: { index: false },
};

export default async function LibraryPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const [allBooks, sensitivities] = await Promise.all([
    getUserBooks(session.userId),
    getUserContentSensitivities(session.userId),
  ]);

  // Build a map of categoryId → maxTolerance for content conflict detection
  const contentPrefsMap: Record<string, number> = {};
  for (const cp of sensitivities.contentPreferences) {
    contentPrefsMap[cp.categoryId] = cp.maxTolerance;
  }

  return (
    <Suspense>
      <LibraryClient books={allBooks} contentPrefs={contentPrefsMap} />
    </Suspense>
  );
}
