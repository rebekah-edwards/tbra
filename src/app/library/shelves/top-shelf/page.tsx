import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserFavorites } from "@/lib/queries/favorites";
import { getUserBooks } from "@/lib/queries/reading-state";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { TopShelfClient } from "./top-shelf-client";

export const metadata: Metadata = {
  title: "Top Shelf | The Based Reader App",
  description: "Manage your all-time favorite books.",
  robots: { index: false },
};

export default async function TopShelfPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  // allBooks feeds the "Add Books" sheet (same picker as custom shelves).
  const [favorites, userRow, allBooks] = await Promise.all([
    getUserFavorites(session.userId),
    db.select({ avatarUrl: users.avatarUrl }).from(users).where(eq(users.id, session.userId)).get(),
    getUserBooks(session.userId),
  ]);

  return (
    <TopShelfClient
      favorites={favorites}
      allBooks={allBooks}
      userAvatarUrl={userRow?.avatarUrl ?? null}
    />
  );
}
