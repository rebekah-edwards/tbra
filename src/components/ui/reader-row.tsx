import Link from "next/link";
import type { ReactNode } from "react";

/**
 * One reader in a list (followers, following, Find Readers) — design refresh
 * 2026-11: a glass row with the avatar in the wordmark ring, the name in the
 * heading face, and an optional trailing control (Follow pill or chevron).
 */
export function ReaderAvatar({
  avatarUrl,
  name,
  size = 44,
}: {
  avatarUrl: string | null;
  name: string;
  size?: number;
}) {
  return (
    <span
      className="flex-shrink-0 rounded-full p-[1.5px]"
      style={{ background: "linear-gradient(135deg, #a3e635, #38bdf8 55%, #c084fc)" }}
    >
      <span className="block rounded-full bg-surface p-[2px]">
        <span
          className="flex items-center justify-center overflow-hidden rounded-full bg-accent font-heading font-bold text-black"
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            (name[0] ?? "?").toUpperCase()
          )}
        </span>
      </span>
    </span>
  );
}

export function ReaderRow({
  href,
  avatarUrl,
  name,
  username,
  bio,
  trailing,
  meta,
}: {
  href: string | null;
  avatarUrl: string | null;
  name: string;
  username: string | null;
  bio?: string | null;
  /** A control on the right. Without one the whole row links and shows a chevron. */
  trailing?: ReactNode;
  /** Small text before the chevron of a linked row ("Joined Nov 3"). */
  meta?: ReactNode;
}) {
  const body = (
    <>
      <ReaderAvatar avatarUrl={avatarUrl} name={name} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-heading text-[15px] font-bold leading-tight text-foreground">
          {name}
        </span>
        {username && <span className="block truncate text-xs text-muted">@{username}</span>}
        {bio && <span className="mt-0.5 block line-clamp-1 text-xs text-muted/80">{bio}</span>}
      </span>
    </>
  );

  if (trailing) {
    return (
      <div className="row-glass flex items-center gap-3 p-3">
        {href ? (
          <Link href={href} className="flex min-w-0 flex-1 items-center gap-3">
            {body}
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-3">{body}</span>
        )}
        <span className="flex-shrink-0">{trailing}</span>
      </div>
    );
  }

  return (
    <Link href={href ?? "#"} className="row-glass flex items-center gap-3 p-3">
      {body}
      {meta && <span className="flex-shrink-0 text-[11px] text-muted">{meta}</span>}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-muted/60" aria-hidden="true">
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </Link>
  );
}
