import { redirect } from "next/navigation";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { getLandingBooks } from "@/lib/actions/landing";
import { LandingAdminClient } from "./landing-admin-client";

export const dynamic = "force-dynamic";

export default async function AdminLandingPage() {
  const user = await getCurrentUser();
  if (!user || !isSuperAdmin(user)) redirect("/");

  const landingBooks = await getLandingBooks();

  const paradeBooks = landingBooks.filter((b: typeof landingBooks[number]) => b.type === "parade");
  const featuredBook = landingBooks.find((b: typeof landingBooks[number]) => b.type === "featured") ?? null;

  return (
    <div className="pb-12">
      <h1 className="text-foreground text-2xl font-bold mb-2">Landing Page Books</h1>
      <p className="text-sm text-muted mb-8">
        Manage which books appear on the landing page hero background and book parade.
      </p>

      <LandingAdminClient paradeBooks={paradeBooks} featuredBook={featuredBook} />
    </div>
  );
}
