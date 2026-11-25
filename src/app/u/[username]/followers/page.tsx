import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getUserByUsername } from "@/lib/queries/profile";
import { getFollowers, isFollowing } from "@/lib/queries/follows";
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
    title: `${displayName}'s Followers | tbr*a`,
    robots: { index: false },
  };
}

export default async function FollowersPage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  const user = await getUserByUsername(username);
  if (!user) notFound();

  const [followers, session] = await Promise.all([
    getFollowers(user.id),
    getCurrentUser(),
  ]);

  // Check which followers the current user is following
  const followingMap = new Map<string, boolean>();
  if (session) {
    await Promise.all(
      followers.map(async (f) => {
        const following = await isFollowing(session.userId, f.userId);
        followingMap.set(f.userId, following);
      })
    );
  }

  const displayName = user.displayName || user.username || "User";

  return (
    <FollowList
      mode="followers"
      username={user.username}
      displayName={displayName}
      people={followers}
      followingMap={followingMap}
      viewerId={session?.userId ?? null}
    />
  );
}
