import type { Metadata } from "next";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { getFollowedUserIds } from "@/lib/queries/follows";
import { BrowseClient } from "./browse-client";

export const metadata: Metadata = {
  title: "Browse All Books on tbr*a",
  description: "Browse the full tbr*a book catalog. Filter by genre, rating, and more.",
};

export default async function BrowsePage() {
  const user = await getCurrentUser();

  let followedCount = 0;
  if (user) {
    const followedIds = await getFollowedUserIds(user.userId);
    followedCount = followedIds.size;
  }

  return (
    <Suspense>
      <BrowseClient isLoggedIn={!!user} hasFollows={followedCount > 0} />
    </Suspense>
  );
}
