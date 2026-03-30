import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser, isPremium } from "@/lib/auth";
import { getUserShelves, getFollowedShelves } from "@/lib/queries/shelves";
import { getUserFavorites } from "@/lib/queries/favorites";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { ShelvesClient } from "./shelves-client";

export const metadata: Metadata = {
  title: "My Shelves | The Based Reader App",
  description: "Your custom book shelves on tbr*a.",
  robots: { index: false },
};

export default async function ShelvesPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const [userShelves, followedShelves, favorites, userRow] = await Promise.all([
    getUserShelves(session.userId),
    getFollowedShelves(session.userId),
    getUserFavorites(session.userId),
    db.select({ username: users.username }).from(users).where(eq(users.id, session.userId)).get(),
  ]);
  const premium = isPremium({ accountType: session.accountType });
  const username = userRow?.username;

  return (
    <Suspense>
      <ShelvesClient
        shelves={userShelves}
        followedShelves={followedShelves}
        isPremium={premium}
        favorites={favorites}
        username={username ?? null}
      />
    </Suspense>
  );
}
