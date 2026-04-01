import Link from "next/link";
import Image from "next/image";
import { NoCover } from "@/components/no-cover";
import { PremiumGate } from "@/components/premium-gate";
import type { ShelfSummary } from "@/lib/queries/shelves";

interface ProfileShelvesSectionProps {
  shelves: ShelfSummary[];
  /** Link base for shelf detail links */
  linkBase: string;
  /** Link for "View all" */
  viewAllHref: string;
  /** Show premium gate if not premium (own profile only) */
  isPremium?: boolean;
  /** Whether this is the user's own profile */
  isOwner?: boolean;
}

/** A single shelf rendered as a mini horizontal book row — like Top Shelf but shorter */
function MiniShelfRow({ shelf, linkBase }: { shelf: ShelfSummary; linkBase: string }) {
  const accentColor = shelf.color || "#d97706";

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: accentColor }}
          />
          <Link
            href={`${linkBase}/${shelf.slug}`}
            className="text-xs font-bold text-foreground hover:text-accent transition-colors"
          >
            {shelf.name}
          </Link>
          <span className="text-[10px] text-muted/50">{shelf.bookCount}</span>
        </div>
        <Link href={`${linkBase}/${shelf.slug}`} className="text-[10px] font-medium read-more-link">
          View →
        </Link>
      </div>

      {shelf.coverUrls.length > 0 ? (
        <div className="relative">
          <div
            className="relative rounded-lg border px-3 pt-3 pb-1.5"
            style={{
              background: `linear-gradient(to bottom, ${accentColor}08, ${accentColor}15)`,
              borderColor: `${accentColor}20`,
            }}
          >
            <div className="flex gap-2 items-end overflow-x-auto pb-2.5 -mx-0.5 px-0.5 pr-8 no-scrollbar mask-fade-right">
              {shelf.coverUrls.map((url, i) => {
                const bookSlug = shelf.coverSlugs?.[i];
                const cover = (
                  <Image
                    src={url}
                    alt=""
                    width={46}
                    height={69}
                    className="h-[69px] w-[46px] rounded-sm object-cover shadow-[2px_2px_6px_rgba(0,0,0,0.3)]"
                  />
                );
                return bookSlug ? (
                  <Link key={i} href={`/book/${bookSlug}`} className="shrink-0 hover:opacity-80 transition-opacity">
                    {cover}
                  </Link>
                ) : (
                  <div key={i} className="shrink-0">
                    {cover}
                  </div>
                );
              })}
            </div>
            {/* Shelf edge */}
            <div
              className="h-[5px] -mx-3 rounded-b-lg shadow-[inset_0_2px_3px_rgba(0,0,0,0.1)]"
              style={{ background: `linear-gradient(to bottom, ${accentColor}30, ${accentColor}45)` }}
            />
          </div>
          {/* Shelf shadow */}
          <div className="h-1.5 mx-1 bg-gradient-to-b from-black/8 to-transparent rounded-b-lg" />
        </div>
      ) : (
        <div
          className="rounded-lg border border-dashed p-3 text-center"
          style={{ borderColor: `${accentColor}25` }}
        >
          <p className="text-[10px] text-muted/50">Empty shelf</p>
        </div>
      )}
    </section>
  );
}

export function ProfileShelvesSection({
  shelves,
  linkBase,
  viewAllHref,
  isPremium = true,
  isOwner = false,
}: ProfileShelvesSectionProps) {
  // On own profile, show premium gate if not premium
  if (isOwner && !isPremium) {
    return (
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="section-heading text-sm">Shelves</h2>
        </div>
        <PremiumGate isPremium={false} featureName="Custom Shelves" />
      </section>
    );
  }

  // Don't show section if no shelves on others' profiles
  if (!isOwner && shelves.length === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="section-heading text-sm">Shelves</h2>
        {shelves.length > 0 && (
          <Link href={viewAllHref} className="text-xs font-medium read-more-link">
            View all →
          </Link>
        )}
      </div>

      {shelves.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <p className="text-sm text-muted">No shelves yet</p>
          <Link
            href="/library/shelves"
            className="mt-2 inline-block text-xs font-medium text-accent hover:text-accent-dark"
          >
            Create your first shelf →
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {shelves.slice(0, 3).map((shelf) => (
            <MiniShelfRow key={shelf.id} shelf={shelf} linkBase={linkBase} />
          ))}
          {shelves.length > 3 && (
            <Link
              href={viewAllHref}
              className="block text-center text-xs font-medium text-muted hover:text-foreground transition-colors py-2"
            >
              +{shelves.length - 3} more {shelves.length - 3 === 1 ? "shelf" : "shelves"}
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
