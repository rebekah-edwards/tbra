import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUserByUsername } from "@/lib/queries/profile";
import { getFollowing, isFollowing } from "@/lib/queries/follows";
import { getCurrentUser } from "@/lib/auth";
import { FollowList } from "@/components/profile/follow-list";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>;
}): Promise<Metadata> {
  const { username } = await params;
  const user = await getUserByUsername(username);
  if (!user) return { title: "User Not Found | tbr*a" };
  const displayName = user.displayName || user.username || "User";
  return {
    title: `${displayName} is Following | tbr*a`,
    robots: { index: false },
  };
}

export default async function FollowingPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const user = await getUserByUsername(username);
  if (!user) notFound();

  const [following, session] = await Promise.all([
    getFollowing(user.id),
    getCurrentUser(),
  ]);

  // Check which users the current user is following
  const followingMap = new Map<string, boolean>();
  if (session) {
    await Promise.all(
      following.map(async (f) => {
        const isFollowingUser = await isFollowing(session.userId, f.userId);
        followingMap.set(f.userId, isFollowingUser);
      })
    );
  }

  const displayName = user.displayName || user.username || "User";

  return (
    <FollowList
      mode="following"
      username={user.username}
      displayName={displayName}
      people={following}
      followingMap={followingMap}
      viewerId={session?.userId ?? null}
    />
  );
}
