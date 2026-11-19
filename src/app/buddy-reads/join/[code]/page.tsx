import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { getBuddyReadByInviteCode, isBuddyReadMember } from "@/lib/queries/buddy-reads";
import { NoCover } from "@/components/no-cover";
import { JoinBuddyReadButton } from "@/components/buddy-reads/join-buddy-read-button";

interface Props {
  params: Promise<{ code: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const br = await getBuddyReadByInviteCode(code);
  if (!br) return { title: "Invite Not Found | tbr*a" };

  return {
    title: `Join ${br.name} | Buddy Read | tbr*a`,
    description: `Join a buddy read for ${br.bookTitle} on tbr*a.`,
  };
}

export default async function JoinBuddyReadPage({ params }: Props) {
  const { code } = await params;
  const br = await getBuddyReadByInviteCode(code);
  if (!br) notFound();

  const session = await getCurrentUser();

  // If logged in, check membership
  if (session) {
    const membership = await isBuddyReadMember(br.id, session.userId);
    if (membership && membership.status === "active") {
      redirect(`/buddy-reads/${br.slug}`);
    }
  }

  // 2026-11 refresh: the invite is a hero card on the book's own blurred
  // cover art inside the wordmark hairline, cover tipped, one lime action.
  return (
    <div className="mx-auto max-w-md px-4 pb-32 pt-10">
      <div
        className="rounded-[22px] p-px"
        style={{
          background:
            "linear-gradient(135deg, rgba(163,230,53,0.55), rgba(56,189,248,0.35), rgba(192,132,252,0.45))",
        }}
      >
        <div className="relative overflow-hidden rounded-[21px] bg-surface">
          {br.bookCoverImageUrl && (
            <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
              <Image
                src={br.bookCoverImageUrl}
                alt=""
                fill
                sizes="448px"
                className="book-card-bg-img scale-150 object-cover"
              />
              <div className="absolute inset-0 currently-reading-overlay" />
            </div>
          )}

          <div className="relative flex flex-col items-center p-8 text-center">
            <div className="mb-5 h-[156px] w-[104px] -rotate-3 overflow-hidden rounded-lg shadow-[0_12px_28px_rgba(0,0,0,0.5)] ring-1 ring-white/10">
              {br.bookCoverImageUrl ? (
                <Image
                  src={br.bookCoverImageUrl}
                  alt={`Cover of ${br.bookTitle}`}
                  width={104}
                  height={156}
                  className="h-full w-full object-cover"
                />
              ) : (
                <NoCover title={br.bookTitle} className="h-full w-full" size="md" />
              )}
            </div>

            <span className="inline-flex items-center gap-1.5 rounded-full border border-foreground/10 bg-surface/80 px-2.5 py-1 text-[11px] font-semibold text-foreground backdrop-blur-md">
              <span className="h-[7px] w-[7px] rounded-full bg-neon-purple" aria-hidden="true" />
              You&apos;re invited to a buddy read
            </span>
            <h1 className="mt-3 font-heading text-[22px] font-bold leading-tight book-header-text">
              {br.bookTitle}
            </h1>
            <p className="mt-1 text-xs book-header-text-sub">
              {br.memberCount} {br.memberCount === 1 ? "reader" : "readers"} so far
            </p>

            {br.description && (
              <p className="mt-4 max-w-xs text-sm leading-relaxed book-header-text-sub">{br.description}</p>
            )}

            <div className="mt-6">
              {session ? (
                <JoinBuddyReadButton
                  buddyReadId={br.id}
                  initialIsMember={false}
                  initialStatus={null}
                />
              ) : (
                <Link
                  href={`/signup?redirect=${encodeURIComponent(`/buddy-reads/join/${code}`)}`}
                  className="btn-lime px-7 py-2.5 text-sm"
                >
                  Sign up to join
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
