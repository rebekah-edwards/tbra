import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getReferredUsers } from "@/lib/referrals";
import { ReaderRow } from "@/components/ui/reader-row";
import { HERO_BACK_BUTTON_CLASS } from "@/components/ui/cover-art-hero";

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

export default async function ReferralsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const referred = await getReferredUsers(session.userId);

  return (
    <div className="space-y-5 lg:max-w-[60%] lg:mx-auto px-4 lg:px-0 pt-2 pb-24">
      <div className="flex items-center gap-3">
        <Link href="/profile" className={HERO_BACK_BUTTON_CLASS} aria-label="Back to profile">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6" />
          </svg>
        </Link>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Invites</p>
          <h1 className="font-heading text-[22px] font-bold leading-tight tracking-tight text-foreground">
            Your referrals
          </h1>
        </div>
      </div>

      <div className="flex justify-center">
        <span className="chip-glass">
          <span className="dot bg-neon-blue" />
          {referred.length === 0
            ? "No one has joined yet"
            : `${referred.length} ${referred.length === 1 ? "reader" : "readers"} joined through your link`}
        </span>
      </div>

      {referred.length === 0 ? (
        <div className="card-glass flex flex-col items-center px-6 py-10 text-center">
          <span className="orb-glass mb-3 h-14 w-14">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-neon-blue" aria-hidden="true">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
          </span>
          <p className="font-heading text-base font-semibold text-foreground">Bring a friend along</p>
          <p className="mt-1 mb-5 max-w-xs text-sm text-muted">
            Share your invite link and the readers who sign up with it show up here.
          </p>
          <Link href="/profile" className="btn-lime px-5 py-2.5 text-sm">
            Get your link
          </Link>
        </div>
      ) : (
        <ul className="space-y-2">
          {referred.map((u) => (
            <li key={u.id}>
              <ReaderRow
                href={u.username ? `/u/${u.username}` : "/profile"}
                avatarUrl={u.avatarUrl}
                name={u.displayName || u.username || "Unnamed reader"}
                username={u.username}
                meta={<>Joined {memberSince(u.createdAt)}</>}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
