import { redirect } from "next/navigation";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { getLandingBooks, getLandingCopy } from "@/lib/actions/landing";
import { LandingAdminClient } from "./landing-admin-client";
import { LandingCopyEditor } from "./landing-copy-editor";

export const dynamic = "force-dynamic";

export default async function AdminLandingPage() {
  const user = await getCurrentUser();
  if (!user || !isSuperAdmin(user)) redirect("/");

  const landingBooks = await getLandingBooks();
  const landingCopy = await getLandingCopy();

  const paradeBooks = landingBooks.filter((b: typeof landingBooks[number]) => b.type === "parade");
  const featuredBook = landingBooks.find((b: typeof landingBooks[number]) => b.type === "featured") ?? null;

  return (
    <div className="pb-12 space-y-12 lg:w-[60%] lg:mx-auto">
      <div>
        <h1 className="text-foreground text-2xl font-bold mb-2">Landing Page</h1>
        <p className="text-sm text-muted mb-8">
          Manage copy and books on the logged-out homepage.
        </p>
      </div>

      <div>
        <h2 className="text-foreground text-xl font-bold mb-4">Page Copy</h2>
        <LandingCopyEditor sections={landingCopy} />
      </div>

      <div>
        <h2 className="text-foreground text-xl font-bold mb-4">Book Parade &amp; Featured Book</h2>
        <LandingAdminClient paradeBooks={paradeBooks} featuredBook={featuredBook} />
      </div>
    </div>
  );
}
