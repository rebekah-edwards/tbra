import Link from "next/link";
import type { ReactNode } from "react";
import { AccountBadge } from "@/components/profile/account-badge";

// The top of a reader's profile, shared by /profile (the owner's own page) and
// /u/[username] (everyone else's view) so the two never drift apart again.
// 2026-11 refresh: one hero card with the wordmark hairline, the avatar in a
// lime→blue→purple ring, the name in the heading face, and the three counts as
// glass tiles with an eyebrow label and a colour dot instead of coloured
// borders. Content is centred as a group on phones (Rebekah has asked twice
// for cards that don't hug the left edge).

export interface ProfileHeroStats {
  completed: number;
  currentlyReading: number;
  tbr: number;
}

interface ProfileHeroProps {
  name: string;
  username: string | null;
  avatarUrl: string | null;
  initial: string;
  accountType: string;
  bio: string | null;
  /** Already filtered by the location-visibility rule. */
  location: string | null;
  memberSince: string;
  followerCount: number;
  followingCount: number;
  stats: ProfileHeroStats;
  /** Owner's page links each tile to the matching Library view. */
  statHrefs?: { completed: string; currentlyReading: string; tbr: string };
  /** Top-right corner of the card (share / safety menu). */
  corner?: ReactNode;
  /** The row of buttons under the counts (Follow, Edit Profile…). */
  actions?: ReactNode;
  socials?: ReactNode;
}

function StatTile({
  label,
  value,
  dot,
  href,
}: {
  label: string;
  value: number;
  dot: string;
  href?: string;
}) {
  const body = (
    <>
      <span className="eyebrow flex items-center justify-center gap-1.5">
        <span className={`h-[7px] w-[7px] rounded-full ${dot}`} aria-hidden="true" />
        {label}
      </span>
      <span className="mt-1 block font-heading text-2xl font-bold leading-none text-foreground tabular-nums">
        {value.toLocaleString("en-US")}
      </span>
    </>
  );
  const cls =
    "block rounded-[18px] border border-foreground/10 bg-surface/60 px-2 py-3 text-center backdrop-blur-md";
  return href ? (
    <Link href={href} className={`${cls} transition-colors hover:border-foreground/25`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function ProfileHero({
  name,
  username,
  avatarUrl,
  initial,
  accountType,
  bio,
  location,
  memberSince,
  followerCount,
  followingCount,
  stats,
  statHrefs,
  corner,
  actions,
  socials,
}: ProfileHeroProps) {
  const counts = (
    <>
      <strong className="text-foreground">{followerCount.toLocaleString("en-US")}</strong>{" "}
      <span className="text-muted">{followerCount === 1 ? "follower" : "followers"}</span>
    </>
  );
  const following = (
    <>
      <strong className="text-foreground">{followingCount.toLocaleString("en-US")}</strong>{" "}
      <span className="text-muted">following</span>
    </>
  );

  return (
    <section className="card-hairline relative overflow-hidden p-5 lg:p-6">
      {/* Soft wash of the three brand colours behind the avatar. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[120%] -translate-x-1/2 opacity-60 blur-3xl"
        style={{
          background:
            "radial-gradient(closest-side, rgba(163,230,53,0.16), rgba(56,189,248,0.10) 55%, rgba(192,132,252,0.08) 80%, transparent)",
        }}
      />

      {corner && <div className="absolute right-3 top-3 z-10 flex items-center gap-1">{corner}</div>}

      <div className="relative flex flex-col items-center text-center lg:flex-row lg:items-start lg:gap-6 lg:text-left">
        {/* Avatar in the wordmark ring */}
        <div
          className="flex-shrink-0 rounded-full p-[2px]"
          style={{ background: "linear-gradient(135deg, #a3e635, #38bdf8 55%, #c084fc)" }}
        >
          <div className="rounded-full bg-surface p-[3px]">
            <div className="flex h-[84px] w-[84px] items-center justify-center overflow-hidden rounded-full bg-accent font-heading text-3xl font-bold text-black">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                initial
              )}
            </div>
          </div>
        </div>

        <div className="mt-3 min-w-0 max-w-full lg:mt-0 lg:flex-1">
          <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 lg:justify-start lg:pr-16">
            <h1 className="font-heading text-[22px] font-bold leading-tight tracking-tight text-foreground line-clamp-2">
              {name}
            </h1>
            <AccountBadge accountType={accountType} />
          </div>
          <p className="mt-1 text-xs text-muted">
            {username && <>@{username} · </>}Member since {memberSince}
          </p>

          {bio && (
            <p className="mx-auto mt-2.5 max-w-md whitespace-pre-line text-sm leading-relaxed text-foreground/90 lg:mx-0">
              {bio}
            </p>
          )}

          {location && (
            <p className="mt-2 inline-flex items-center gap-1 text-xs text-muted">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {location}
            </p>
          )}

          <div className="mt-2 flex items-center justify-center gap-2 text-sm lg:justify-start">
            {username ? (
              <>
                <Link href={`/u/${username}/followers`} className="transition-colors hover:text-neon-blue">
                  {counts}
                </Link>
                <span className="text-muted" aria-hidden="true">·</span>
                <Link href={`/u/${username}/following`} className="transition-colors hover:text-neon-blue">
                  {following}
                </Link>
              </>
            ) : (
              <>
                <span>{counts}</span>
                <span className="text-muted" aria-hidden="true">·</span>
                <span>{following}</span>
              </>
            )}
          </div>

          {actions && (
            <div className="mt-3.5 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
              {actions}
            </div>
          )}

          {socials && <div className="mt-3.5">{socials}</div>}
        </div>
      </div>

      <div className="relative mt-5 grid grid-cols-3 gap-2.5">
        <StatTile label="Read" value={stats.completed} dot="bg-neon-purple" href={statHrefs?.completed} />
        <StatTile label="Reading" value={stats.currentlyReading} dot="bg-neon-blue" href={statHrefs?.currentlyReading} />
        <StatTile label="TBR" value={stats.tbr} dot="bg-accent" href={statHrefs?.tbr} />
      </div>
    </section>
  );
}
