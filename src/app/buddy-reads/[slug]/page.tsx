import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import {
  getBuddyReadBySlug,
  getBuddyReadDetail,
  getBuddyReadMessages,
  isBuddyReadMember,
} from "@/lib/queries/buddy-reads";
import { BuddyReadDetailClient } from "./buddy-read-detail-client";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const br = await getBuddyReadBySlug(slug);
  if (!br) return { title: "Not Found | tbr*a" };

  const detail = await getBuddyReadDetail(br.id);
  const bookTitle = detail?.book.title ?? "";

  return {
    title: `${br.name} | Buddy Read | tbr*a`,
    description: bookTitle
      ? `Buddy read for ${bookTitle} on tbr*a.`
      : `Buddy read on tbr*a.`,
    robots: { index: false },
  };
}

export default async function BuddyReadDetailPage({ params }: Props) {
  const session = await getCurrentUser();
  if (!session) redirect("/login");

  const { slug } = await params;
  const br = await getBuddyReadBySlug(slug);
  if (!br) notFound();

  const [detail, messages, membership] = await Promise.all([
    getBuddyReadDetail(br.id),
    getBuddyReadMessages(br.id),
    isBuddyReadMember(br.id, session.userId),
  ]);

  if (!detail) notFound();

  // If private and user is not a member, show restricted message
  if (!br.isPublic && !membership) {
    return (
      <div className="mx-auto max-w-xl px-4 pb-32 pt-6">
        <div className="flex flex-col items-center justify-center rounded-2xl border border-border bg-surface p-10 text-center">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mb-3 text-muted"
          >
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          <p className="text-lg font-heading font-semibold text-foreground mb-1">
            Private Buddy Read
          </p>
          <p className="text-sm text-muted">
            You need an invite link to view this buddy read.
          </p>
        </div>
      </div>
    );
  }

  const isHost = br.createdBy === session.userId;

  return (
    <BuddyReadDetailClient
      detail={detail}
      messages={messages.map((m) => ({
        id: m.id,
        userId: m.user.id,
        displayName: m.user.displayName ?? m.user.username ?? "Reader",
        username: m.user.username ?? "",
        avatarUrl: m.user.avatarUrl ?? null,
        message: m.message,
        createdAt: m.createdAt,
      }))}
      membership={membership}
      isHost={isHost}
      currentUserId={session.userId}
    />
  );
}
