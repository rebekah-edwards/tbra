import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getReferredUsers } from "@/lib/referrals";

export const metadata: Metadata = {
  title: "Your referrals | tbr*a",
  robots: { index: false },
};

function memberSince(date: string): string {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(displayName: string | null, username: string | null): string {
  const source = displayName || username || "?";
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]!.toUpperCase();
  return (parts[0][0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default async function ReferralsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const referred = await getReferredUsers(session.userId);

  return (
    <div className="space-y-5 lg:max-w-[60%] lg:mx-auto px-4 lg:px-0 pt-2 pb-10">
      <div className="flex items-center gap-3">
        <Link
          href="/profile"
          className="rounded-full p-2 -ml-2 text-muted hover:text-foreground hover:bg-surface-alt transition-colors"
          aria-label="Back to profile"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Your referrals
          </h1>
          <p className="text-sm text-muted mt-0.5">
            {referred.length === 0
              ? "No one has joined through your link yet."
              : `${referred.length} ${referred.length === 1 ? "person has" : "people have"} joined through your link.`}
          </p>
        </div>
      </div>

      {referred.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-center">
          <p className="text-sm text-muted mb-4">
            Share your invite link with friends and they&apos;ll show up here when they sign up.
          </p>
          <Link
            href="/profile"
            className="inline-block rounded-lg bg-neon-blue/10 border border-neon-blue/30 text-neon-blue px-4 py-2 text-xs font-semibold hover:bg-neon-blue/20 transition-colors"
          >
            Get your link
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {referred.map((u) => {
            const href = u.username ? `/u/${u.username}` : `/profile`;
            const name = u.displayName || u.username || "Unnamed reader";
            return (
              <li key={u.id}>
                <Link
                  href={href}
                  className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-3 hover:border-neon-blue/40 hover:bg-neon-blue/5 transition-colors"
                >
                  <div className="flex-shrink-0 w-11 h-11 rounded-full bg-surface-alt overflow-hidden border border-border/50 flex items-center justify-center">
                    {u.avatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={u.avatarUrl}
                        alt={name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-sm font-semibold text-muted">
                        {initials(u.displayName, u.username)}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {name}
                    </p>
                    {u.username && (
                      <p className="text-xs text-muted truncate">@{u.username}</p>
                    )}
                  </div>
                  <p className="flex-shrink-0 text-xs text-muted">
                    Joined {memberSince(u.createdAt)}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
