"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { KeyboardEvent, MouseEvent } from "react";

export type AuthorRef = string | { name: string; slug?: string | null; id?: string | null };

/** Author page URL: slug, then id, then the name (resolveAuthor falls back to a name match). */
export function authorHref(a: AuthorRef): string {
  if (typeof a === "string") return `/author/${encodeURIComponent(a)}`;
  return `/author/${a.slug || a.id || encodeURIComponent(a.name)}`;
}

/**
 * Comma-separated author names, each linking to its author page.
 * `nested` is for names inside a larger link (a whole-card <Link>): a nested
 * <a> is invalid HTML and breaks hydration, so those render as link-role spans
 * that navigate on click without triggering the card.
 */
export function AuthorLinks({
  authors,
  nested = false,
  className = "hover:text-neon-blue hover:underline transition-colors",
}: {
  authors: AuthorRef[];
  nested?: boolean;
  className?: string;
}) {
  const router = useRouter();
  const list = authors.filter((a) => (typeof a === "string" ? a : a.name));
  return (
    <>
      {list.map((a, i) => {
        const name = typeof a === "string" ? a : a.name;
        const href = authorHref(a);
        const go = (e: MouseEvent | KeyboardEvent) => {
          e.preventDefault();
          e.stopPropagation();
          router.push(href);
        };
        return (
          <span key={`${name}-${i}`}>
            {i > 0 && ", "}
            {nested ? (
              <span
                role="link"
                tabIndex={0}
                className={`cursor-pointer ${className}`}
                onClick={go}
                onKeyDown={(e) => { if (e.key === "Enter") go(e); }}
              >
                {name}
              </span>
            ) : (
              <Link href={href} className={className} onClick={(e) => e.stopPropagation()}>
                {name}
              </Link>
            )}
          </span>
        );
      })}
    </>
  );
}
