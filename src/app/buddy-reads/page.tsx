import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getUserBuddyReads } from "@/lib/queries/buddy-reads";
import { BuddyReadCard } from "@/components/buddy-reads/buddy-read-card";

export const metadata: Metadata = {
  title: "Buddy Reads | tbr*a",
  description: "Read together with friends. Join or create buddy reads on tbr*a.",
  robots: { index: false },
};

export default async function BuddyReadsPage() {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const buddyReads = await getUserBuddyReads(session.userId);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-32 pt-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <p className="eyebrow">Read together</p>
          <h1 className="text-foreground text-2xl font-bold tracking-tight">
            Buddy Reads
          </h1>
        </div>
        <Link
          href="/buddy-reads/new"
          className="btn-lime px-4 py-2 text-sm"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          New
        </Link>
      </div>

      {buddyReads.length === 0 ? (
        <div className="card-hairline flex flex-col items-center justify-center p-10 text-center">
          <span className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-foreground/12 bg-surface/70 backdrop-blur-md">
          <svg
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-neon-blue"
            aria-hidden="true"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          </span>
          <p className="text-lg font-heading font-semibold text-foreground mb-1">
            Start reading with friends!
          </p>
          <p className="text-sm text-muted mb-5">
            Create a buddy read and invite others to read along with you.
          </p>
          <Link
            href="/buddy-reads/new"
            className="btn-lime px-5 py-2.5 text-sm"
          >
            Create Your First Buddy Read
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {buddyReads.map((br) => {
            const host =
              br.host.userId === session.userId
                ? "you"
                : br.host.displayName || (br.host.username ? `@${br.host.username}` : "");
            return (
              <BuddyReadCard
                key={br.id}
                id={br.id}
                slug={br.slug}
                name={br.name}
                bookTitle={br.book.title}
                bookCoverUrl={br.book.coverImageUrl}
                memberCount={br.memberCount}
                status={br.status as "active" | "completed"}
                hostName={host}
                invited={br.myStatus === "invited"}
                myProgress={null}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
