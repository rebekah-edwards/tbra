import Link from "next/link";
import { BackButton } from "@/components/ui/back-button";
import { HERO_BACK_BUTTON_CLASS } from "@/components/ui/cover-art-hero";
import { ReaderRow } from "@/components/ui/reader-row";
import { FollowButton } from "@/components/profile/follow-button";

interface FollowPerson {
  userId: string;
  displayName: string | null;
  username: string | null;
  avatarUrl: string | null;
}

/**
 * Followers / Following (design refresh 2026-11): a glass switch between the
 * two lists, the reader's name as the eyebrow, and glass reader rows whose
 * Follow control stays glass so the switch is the screen's one lime.
 */
export function FollowList({
  mode,
  username,
  displayName,
  people,
  followingMap,
  viewerId,
}: {
  mode: "followers" | "following";
  username: string | null;
  displayName: string;
  people: FollowPerson[];
  followingMap: Map<string, boolean>;
  viewerId: string | null;
}) {
  const base = `/u/${username}`;
  const empty = mode === "followers" ? "No followers yet" : "Not following anyone yet";

  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-32 pt-4">
      <div className="flex items-center gap-3">
        <BackButton className={HERO_BACK_BUTTON_CLASS} />
        <div className="min-w-0 flex-1">
          <p className="eyebrow truncate">{displayName}</p>
          <h1 className="font-heading text-[22px] font-bold leading-tight tracking-tight text-foreground">
            {mode === "followers" ? "Followers" : "Following"}
          </h1>
        </div>
        <Link href={base} className="flex-shrink-0 text-xs font-medium text-neon-blue hover:text-neon-blue/80">
          View profile
        </Link>
      </div>

      <nav className="seg-glass mt-5" aria-label="Followers or following">
        <Link href={`${base}/followers`} data-active={mode === "followers" ? "true" : undefined} aria-current={mode === "followers" ? "page" : undefined}>
          Followers
        </Link>
        <Link href={`${base}/following`} data-active={mode === "following" ? "true" : undefined} aria-current={mode === "following" ? "page" : undefined}>
          Following
        </Link>
      </nav>

      <p className="eyebrow mt-6 mb-2.5 text-center">
        {mode === "followers"
          ? `${people.length} ${people.length === 1 ? "follower" : "followers"}`
          : `${people.length} following`}
      </p>

      {people.length === 0 ? (
        <div className="card-glass flex flex-col items-center px-6 py-10 text-center">
          <span className="orb-glass mb-3 h-14 w-14">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          </span>
          <p className="font-heading text-base font-semibold text-foreground">{empty}</p>
          <Link href="/people" className="mt-1 text-sm text-neon-blue hover:text-neon-blue/80">
            Find readers
          </Link>
        </div>
      ) : (
        <div className="space-y-2">
          {people.map((f) => {
            const name = f.displayName ?? f.username ?? "Unknown";
            const isOwn = viewerId === f.userId;
            return (
              <ReaderRow
                key={f.userId}
                href={f.username ? `/u/${f.username}` : null}
                avatarUrl={f.avatarUrl}
                name={name}
                username={f.username}
                trailing={
                  viewerId && !isOwn ? (
                    <FollowButton
                      targetUserId={f.userId}
                      initialIsFollowing={followingMap.get(f.userId) ?? false}
                      tone="quiet"
                    />
                  ) : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
