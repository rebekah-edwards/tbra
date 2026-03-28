import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser, isPremium } from "@/lib/auth";
import { getShelfBySlug, getShelfWithBooks } from "@/lib/queries/shelves";
import { getUserBooks } from "@/lib/queries/reading-state";
import { getUser } from "@/lib/queries/profile";
import { ShelfDetailClient } from "./shelf-detail-client";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return {
    title: "Shelf | The Based Reader App",
    robots: { index: false },
  };
}

export default async function ShelfDetailPage({ params }: Props) {
  const { slug } = await params;
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const shelfRef = await getShelfBySlug(session.userId, slug);
  if (!shelfRef) notFound();

  const shelf = await getShelfWithBooks(shelfRef.id);
  if (!shelf) notFound();

  // Fetch all user books for the "Add Books" modal
  const [allBooks, user] = await Promise.all([
    getUserBooks(session.userId),
    getUser(session.userId),
  ]);
  const premium = isPremium({ accountType: session.accountType });

  return (
    <Suspense>
      <ShelfDetailClient
        shelf={shelf}
        allBooks={allBooks}
        isPremium={premium}
        username={user?.username || undefined}
      />
    </Suspense>
  );
}
