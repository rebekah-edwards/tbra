import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { resolveBook } from "@/lib/queries/books";
import { CreateBuddyReadClient } from "./create-buddy-read-client";

export const metadata: Metadata = {
  title: "New Buddy Read | tbr*a",
  robots: { index: false },
};

export default async function NewBuddyReadPage({
  searchParams,
}: {
  searchParams: Promise<{ bookId?: string }>;
}) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const params = await searchParams;

  let prefillBook: { id: string; title: string; coverImageUrl: string | null } | null = null;

  if (params.bookId) {
    const result = await resolveBook(params.bookId);
    if (result) {
      prefillBook = {
        id: result.book.id,
        title: result.book.title,
        coverImageUrl: result.book.coverImageUrl ?? null,
      };
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-32 pt-6">
      <h1 className="neon-heading text-2xl font-heading font-bold mb-6">
        New Buddy Read
      </h1>
      <CreateBuddyReadClient prefillBook={prefillBook} />
    </div>
  );
}
