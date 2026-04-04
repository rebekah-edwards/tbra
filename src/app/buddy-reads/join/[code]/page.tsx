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

  return (
    <div className="mx-auto max-w-md px-4 pb-32 pt-10">
      <div className="flex flex-col items-center rounded-2xl border border-border bg-surface p-8 text-center">
        {/* Book cover */}
        <div className="h-36 w-24 overflow-hidden rounded-lg shadow-md mb-5">
          {br.bookCoverImageUrl ? (
            <Image
              src={br.bookCoverImageUrl}
              alt={br.bookTitle}
              width={96}
              height={144}
              className="h-full w-full object-cover"
            />
          ) : (
            <NoCover title={br.bookTitle} size="md" />
          )}
        </div>

        <p className="text-xs uppercase tracking-wider text-muted font-semibold mb-1">
          You&apos;re invited to join
        </p>
        <h1 className="neon-heading text-xl font-heading font-bold mb-1">
          {br.name}
        </h1>
        <p className="text-sm text-muted mb-1">{br.bookTitle}</p>
        <p className="text-xs text-muted mb-5">
          {br.memberCount} {br.memberCount === 1 ? "member" : "members"}
        </p>

        {br.description && (
          <p className="text-sm text-muted mb-5 max-w-xs">{br.description}</p>
        )}

        {session ? (
          <JoinBuddyReadButton
            buddyReadId={br.id}
            initialIsMember={false}
            initialStatus={null}
          />
        ) : (
          <Link
            href={`/signup?redirect=${encodeURIComponent(`/buddy-reads/join/${code}`)}`}
            className="inline-flex items-center gap-2 rounded-full bg-[#a3e635] px-6 py-3 text-sm font-semibold text-black transition-opacity hover:opacity-90"
          >
            Sign Up to Join
          </Link>
        )}
      </div>
    </div>
  );
}
