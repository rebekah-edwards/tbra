import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser, isPremium } from "@/lib/auth";
import { getUserShelves, getFollowedShelves } from "@/lib/queries/shelves";
import { ShelvesClient } from "./shelves-client";

export const metadata: Metadata = {
  title: "My Shelves | The Based Reader App",
  description: "Your custom book shelves on tbr*a.",
  robots: { index: false },
};

export default async function ShelvesPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const [userShelves, followedShelves] = await Promise.all([
    getUserShelves(session.userId),
    getFollowedShelves(session.userId),
  ]);
  const premium = isPremium({ accountType: session.accountType });

  return (
    <Suspense>
      <ShelvesClient shelves={userShelves} followedShelves={followedShelves} isPremium={premium} />
    </Suspense>
  );
}
