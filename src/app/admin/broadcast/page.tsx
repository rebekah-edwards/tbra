import { redirect } from "next/navigation";
import { getCurrentUser, isSuperAdmin } from "@/lib/auth";
import { BroadcastForm } from "./broadcast-form";

export const dynamic = "force-dynamic";

export default async function AdminBroadcastPage() {
  const user = await getCurrentUser();
  if (!user || !isSuperAdmin(user)) redirect("/");

  return (
    <div className="mx-auto lg:max-w-[60%]">
      <h1 className="text-2xl font-bold text-foreground mb-6">Broadcast Notification</h1>
      <p className="text-sm text-muted mb-6">
        Send a notification to every user&apos;s notification bell. Use sparingly.
      </p>
      <BroadcastForm />
    </div>
  );
}
