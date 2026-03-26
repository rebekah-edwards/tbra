import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getUserBooks } from "@/lib/queries/reading-state";

export const metadata: Metadata = {
  robots: { index: false },
};
import { LibraryClient } from "./library-client";

export default async function LibraryPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const allBooks = await getUserBooks(session.userId);

  return <LibraryClient books={allBooks} />;
}
