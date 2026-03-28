import { redirect } from "next/navigation";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { db } from "@/db";
import { users } from "@/db/schema";
import { desc } from "drizzle-orm";
import { UserManagement } from "@/components/admin/user-management";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const user = await getCurrentUser();
  if (!user || !isSuperAdmin(user)) redirect("/");

  const allUsers = await db
    .select({
      id: users.id,
      email: users.email,
      displayName: users.displayName,
      username: users.username,
      accountType: users.accountType,
      createdAt: users.createdAt,
    })
    .from(users)
    .orderBy(desc(users.createdAt));

  return (
    <div className="space-y-6 lg:w-[60%] lg:mx-auto">
      <div>
        <h1
          className="text-foreground text-2xl font-bold tracking-tight"
         
        >
          User Management
        </h1>
        <p className="text-sm text-muted mt-1">
          Manage account types and permissions
        </p>
      </div>

      <UserManagement users={allUsers} currentUserId={user.userId} />
    </div>
  );
}
