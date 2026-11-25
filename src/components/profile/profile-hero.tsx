import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { AccountBadge } from "@/components/profile/account-badge";
import { VerifiedAuthorBadge } from "@/components/author/verified-author-badge";

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
  covers?: { completed: string[]; currentlyReading: string[]; tbr: string[] };
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
  /** Author pages this account is the verified author of. */
  verifiedAuthors?: { name: string; slug: string | null; authorId: string }[];
}

const TILE_HUES = {
  purple: { rgb: "192,132,252", dot: "bg-neon-purple" },
  blue: { rgb: "56,189,248", dot: "bg-neon-blue" },
  lime: { rgb: "163,230,53", dot: "bg-accent" },
} as const;

/**
 * One of the Read / Reading / TBR cards. Built like Pick From Your Shelf
 * (Rebekah, 2026-11-19: "a little more like the pick from your shelf card"):
 * the card sits on its pile's own blurred cover art, the newest covers fan out
 * tipped as if just pulled off the shelf, and the 1px hairline carries the
 * pile's colour instead of a coloured border.
 */
function StatTile({
  label,
  value,
  hue,
  covers,
  href,
}: {
  label: string;
  value: number;
  hue: keyof typeof TILE_HUES;
  covers: string[];
  href?: string;
}) {
  const { rgb, dot } = TILE_HUES[hue];
  const fan = covers.slice(0, 3);
  // Newest cover front and centre; the next two tipped out behind it.
  const poses: { transform: string; z: number }[] =
    fan.length === 1
      ? [{ transform: "rotate(-4deg)", z: 3 }]
      : fan.length === 2
        ? [
            { transform: "translateX(9px) rotate(5deg)", z: 3 },
            { transform: "translateX(-11px) rotate(-8deg)", z: 2 },
          ]
        : [
            { transform: "translateY(-3px) rotate(-2deg)", z: 3 },
            { transform: "translateX(-19px) rotate(-11deg)", z: 2 },
            { transform: "translateX(19px) rotate(9deg)", z: 1 },
          ];

  const inner = (
    <div className="relative h-full overflow-hidden rounded-[17px] bg-surface">
      {fan[0] && (
        <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
          <Image src={fan[0]} alt="" fill sizes="160px" className="book-card-bg-img scale-150 object-cover" />
          <div className="absolute inset-0 currently-reading-overlay" />
        </div>
      )}
      <div className="relative flex flex-col items-center px-1.5 pb-3 pt-3.5">
        {/* No covers in this pile: no placeholder art — the card collapses
            to just the count and label (Rebekah 2026-11-19: the generic book
            icons took up too much height). */}
        {fan.length > 0 && (
          <div className="relative mb-2.5 flex h-[66px] w-full items-end justify-center" aria-hidden="true">
            {fan.map((url, i) => (
              <div
                key={url}
                className="absolute bottom-0 h-[58px] w-[39px] overflow-hidden rounded-[5px] shadow-[0_6px_14px_rgba(0,0,0,0.45)] ring-1 ring-white/10 transition-transform duration-200"
                style={{ transform: poses[i].transform, zIndex: poses[i].z }}
              >
                <Image src={url} alt="" width={39} height={58} className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        )}
        <span className="block font-heading text-[26px] font-bold leading-none book-header-text tabular-nums">
          {value.toLocaleString("en-US")}
        </span>
        <span className="eyebrow mt-1.5 flex items-center justify-center gap-1.5 !text-[10px] book-header-text-sub">
          <span className={`h-[6px] w-[6px] rounded-full ${dot}`} />
          {label}
        </span>
      </div>
    </div>
  );

  const cls = "group block rounded-[18px] p-px";
  const style = {
    background: `linear-gradient(150deg, rgba(${rgb},0.75), rgba(${rgb},0.18) 55%, rgba(${rgb},0.45))`,
  };
  return href ? (
    <Link href={href} className={`${cls} transition-transform active:scale-[0.97]`} style={style} aria-label={`${value} ${label}`}>
      {inner}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {inner}
    </div>
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
  verifiedAuthors,
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
          {verifiedAuthors && verifiedAuthors.length > 0 && (
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5 lg:justify-start">
              {verifiedAuthors.map((a) => (
                <VerifiedAuthorBadge
                  key={a.authorId}
                  href={`/author/${a.slug ?? a.authorId}`}
                  label={verifiedAuthors.length > 1 ? `Verified author · ${a.name}` : "Verified author"}
                />
              ))}
            </div>
          )}
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

      <div className="relative mt-5 grid grid-cols-3 gap-2.5 lg:gap-3.5">
        <StatTile label="Read" value={stats.completed} hue="purple" covers={stats.covers?.completed ?? []} href={statHrefs?.completed} />
        <StatTile label="Reading" value={stats.currentlyReading} hue="blue" covers={stats.covers?.currentlyReading ?? []} href={statHrefs?.currentlyReading} />
        <StatTile label="TBR" value={stats.tbr} hue="lime" covers={stats.covers?.tbr ?? []} href={statHrefs?.tbr} />
      </div>
    </section>
  );
}
