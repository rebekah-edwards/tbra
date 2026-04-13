import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getUserByUsername } from "@/lib/queries/profile";
import { getFollowers, isFollowing } from "@/lib/queries/follows";
import { getCurrentUser } from "@/lib/auth";
import { BackButton } from "@/components/ui/back-button";
import { FollowButton } from "@/components/profile/follow-button";

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
    <div className="min-h-screen">
      <div className="px-4 py-4 border-b border-border/50">
        <div className="flex items-center gap-2 mb-2">
          <BackButton />
          <Link
            href={`/u/${user.username}`}
            className="text-xs text-neon-blue hover:text-neon-blue/80 transition-colors"
          >
            View Profile
          </Link>
        </div>
        <h1 className="text-foreground text-lg font-bold">
          {displayName}&apos;s Followers
        </h1>
        <p className="text-xs text-muted">{followers.length} {followers.length === 1 ? "follower" : "followers"}</p>
      </div>

      <div className="px-4 py-4 space-y-2">
        {followers.length === 0 && (
          <p className="text-sm text-muted text-center py-8">No followers yet</p>
        )}
        {followers.map((f) => {
          const isOwn = session?.userId === f.userId;
          return (
            <div key={f.userId} className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
              <Link href={f.username ? `/u/${f.username}` : "#"} className="flex-shrink-0">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold overflow-hidden text-black"
                  style={{ backgroundColor: f.avatarUrl ? undefined : "#a3e635" }}
                >
                  {f.avatarUrl ? (
                    <img src={f.avatarUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    (f.displayName?.[0] ?? "?").toUpperCase()
                  )}
                </div>
              </Link>
              <div className="flex-1 min-w-0">
                <Link href={f.username ? `/u/${f.username}` : "#"}>
                  <p className="text-sm font-medium text-foreground truncate hover:text-neon-blue transition-colors">
                    {f.displayName ?? f.username ?? "Unknown"}
                  </p>
                </Link>
                {f.username && (
                  <p className="text-xs text-muted truncate">@{f.username}</p>
                )}
              </div>
              {session && !isOwn && (
                <FollowButton
                  targetUserId={f.userId}
                  initialIsFollowing={followingMap.get(f.userId) ?? false}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
