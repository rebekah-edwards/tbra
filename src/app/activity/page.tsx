import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getFollowedUsersActivityPage } from "@/lib/queries/activity-feed";
import { FriendsActivityFeed } from "@/components/home/friends-activity-feed";

export const metadata: Metadata = {
  title: "Friends Activity | tbr*a",
  description: "What the readers you follow are reading, finishing and reviewing.",
  robots: { index: false },
};

export default async function ActivityPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const first = await getFollowedUsersActivityPage(user.userId, 0, 20);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      {/* Mobile: sits beside the floating back button (same offsets as /people). */}
      <h1 className="text-foreground text-2xl font-bold tracking-tight pl-14 -mt-3 lg:mt-0 lg:pl-0">Friends Activity</h1>
      <FriendsActivityFeed initialItems={first.items} initialNextOffset={first.nextOffset} />
    </div>
  );
}
