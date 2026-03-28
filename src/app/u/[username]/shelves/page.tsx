import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { getUserByUsername } from "@/lib/queries/profile";
import { getPublicShelves } from "@/lib/queries/shelves";
import { ShelfCard } from "@/components/shelves/shelf-card";

interface Props {
  params: Promise<{ username: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const user = await getUserByUsername(username);
  if (!user) return { title: "Not Found" };

  return {
    title: `${user.displayName || username}'s Shelves | tbr*a`,
    description: `Browse ${user.displayName || username}'s public book shelves on tbr*a.`,
  };
}

export default async function PublicShelvesPage({ params }: Props) {
  const { username } = await params;
  const user = await getUserByUsername(username);
  if (!user) notFound();

  const shelves = await getPublicShelves(user.id);

  return (
    <div className="lg:max-w-[60%] lg:mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Link
          href={`/u/${username}`}
          className="p-1.5 -ml-1.5 rounded-lg hover:bg-surface-alt transition-colors text-muted hover:text-foreground"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </Link>
        <div>
          <h1 className="text-foreground text-xl font-bold tracking-tight">
            {user.displayName || username}&apos;s Shelves
          </h1>
          <p className="text-xs text-muted">{shelves.length} public {shelves.length === 1 ? "shelf" : "shelves"}</p>
        </div>
      </div>

      {shelves.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-8 text-center">
          <p className="text-sm text-muted">No public shelves yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shelves.map((shelf) => (
            <ShelfCard
              key={shelf.id}
              shelf={shelf}
              linkBase={`/u/${username}/shelves`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
