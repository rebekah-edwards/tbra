import Link from "next/link";
import type { ReactNode } from "react";

/**
 * First-run starter card (design refresh 2026-11) — mirrors the iOS
 * HomeStarterCard. Shown on Home when a reader has nothing in progress and
 * nothing queued, which in practice means a brand-new account. Three ways
 * in, most valuable first.
 */
export function HomeStarterCard() {
  return (
    <section
      className="rounded-[22px] p-px"
      style={{
        background:
          "linear-gradient(135deg, rgba(163,230,53,0.55), rgba(56,189,248,0.35), rgba(192,132,252,0.45))",
      }}
    >
      <div className="rounded-[21px] bg-surface/90 backdrop-blur-xl p-4 lg:p-6">
        <h2 className="font-heading text-[22px] font-bold text-foreground">Let&rsquo;s build your library</h2>
        <p className="mt-1 text-sm text-muted">Add a few books and tbr*a starts working for you.</p>
        <div className="mt-3.5 grid gap-2 lg:grid-cols-3">
          <Row
            href="/import"
            color="#fb923c"
            title="Bring your library over"
            blurb="Import from Goodreads or StoryGraph in about a minute"
            icon={
              <>
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </>
            }
          />
          <Row
            href="/search"
            color="#38bdf8"
            title="Find a book"
            blurb="Search by title, author or series"
            icon={
              <>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" x2="16.65" y1="21" y2="16.65" />
              </>
            }
          />
          <Row
            href="/discover"
            color="#c084fc"
            title="Find your next read"
            blurb="Pick a mood and we'll match books to it"
            icon={
              <path d="M12 2l1.9 5.6a3 3 0 0 0 1.9 1.9L21.4 11.4l-5.6 1.9a3 3 0 0 0-1.9 1.9L12 20.8l-1.9-5.6a3 3 0 0 0-1.9-1.9L2.6 11.4l5.6-1.9a3 3 0 0 0 1.9-1.9L12 2z" />
            }
          />
        </div>
      </div>
    </section>
  );
}

function Row({
  href,
  color,
  title,
  blurb,
  icon,
}: {
  href: string;
  color: string;
  title: string;
  blurb: string;
  icon: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-[14px] bg-surface-alt/60 p-2.5 transition-colors hover:bg-surface-alt"
    >
      <span
        className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-[11px]"
        style={{ background: `${color}24` }}
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {icon}
        </svg>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-foreground">{title}</span>
        <span className="block text-xs text-muted">{blurb}</span>
      </span>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="flex-shrink-0 text-muted/70" aria-hidden="true">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </Link>
  );
}
