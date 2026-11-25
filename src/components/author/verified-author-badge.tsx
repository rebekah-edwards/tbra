import Link from "next/link";

/**
 * "Verified author" — glass badge with a lime check (design refresh rules:
 * glass + hue in the icon). Shown on a verified author's profile and on
 * their author page.
 */
export function VerifiedAuthorBadge({ href, label = "Verified author" }: { href?: string | null; label?: string }) {
  const inner = (
    <>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className="text-accent" aria-hidden="true">
        <path d="M12 2l2.4 2.1 3.1-.4.9 3 2.8 1.5-1 3 1 3-2.8 1.5-.9 3-3.1-.4L12 22l-2.4-2.1-3.1.4-.9-3L2.8 15.8l1-3-1-3 2.8-1.5.9-3 3.1.4z" />
        <path d="M8.5 12.2l2.3 2.3 4.7-4.8" />
      </svg>
      {label}
    </>
  );
  const cls =
    "inline-flex items-center gap-1.5 rounded-full border border-foreground/12 bg-surface/70 px-2.5 py-1 text-[11px] font-semibold text-foreground backdrop-blur-md";
  return href ? (
    <Link href={href} className={`${cls} hover:border-foreground/25 transition-colors`}>
      {inner}
    </Link>
  ) : (
    <span className={cls}>{inner}</span>
  );
}
