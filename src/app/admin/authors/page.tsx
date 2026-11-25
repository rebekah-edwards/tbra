import { redirect } from "next/navigation";
import { getCurrentUser, isAdmin } from "@/lib/auth";
import { listAuthorClaims, listRecentAuthorEdits } from "@/lib/authors/claims";
import { AuthorsAdmin } from "./authors-admin";

export const metadata = { title: "Authors | Admin | tbr*a", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminAuthorsPage() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user)) redirect("/");
  const [claims, edits] = await Promise.all([listAuthorClaims(), listRecentAuthorEdits(100)]);
  return <AuthorsAdmin claims={claims} edits={edits} />;
}
