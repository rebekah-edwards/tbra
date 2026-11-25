"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminReviewAuthorClaim,
  adminLinkAuthorAccount,
  adminRevertAuthorEdit,
} from "@/lib/actions/author-claims";
import type { listAuthorClaims, listRecentAuthorEdits } from "@/lib/authors/claims";

type Claim = Awaited<ReturnType<typeof listAuthorClaims>>[number];
type Edit = Awaited<ReturnType<typeof listRecentAuthorEdits>>[number];

const LEVELS = ["None", "Mild", "Moderate", "Significant", "Extreme"];

function who(c: { displayName: string | null; username: string | null }) {
  return c.displayName || (c.username ? `@${c.username}` : "Reader");
}

export function AuthorsAdmin({ claims, edits }: { claims: Claim[]; edits: Edit[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [username, setUsername] = useState("");
  const [author, setAuthor] = useState("");
  const [note, setNote] = useState("");

  const run = (fn: () => Promise<{ success: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.success) setError(res.error ?? "Something went wrong");
      router.refresh();
    });
  };

  const pending = claims.filter((c) => c.status === "pending");
  const approved = claims.filter((c) => c.status === "approved");

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <p className="eyebrow">Admin</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Authors</h1>
        <p className="mt-1 text-sm text-muted">
          Author page claims, verified author accounts, and every change a verified author has made to their books.
        </p>
      </div>

      {error && <p className="rounded-2xl border border-red-400/30 bg-surface/70 px-4 py-2.5 text-sm">{error}</p>}

      <section className="space-y-3">
        <h2 className="section-heading text-lg">Claims waiting ({pending.length})</h2>
        {pending.length === 0 && <p className="text-sm text-muted">Nothing waiting.</p>}
        {pending.map((c) => (
          <div key={c.id} className="rounded-[18px] border border-foreground/10 bg-surface/70 p-4 backdrop-blur-md">
            <p className="text-sm text-foreground">
              <Link href={c.username ? `/u/${c.username}` : "#"} className="font-semibold text-neon-blue">{who(c)}</Link>{" "}
              ({c.email}) says they&apos;re{" "}
              <Link href={`/author/${c.authorSlug ?? c.authorId}`} className="font-semibold text-neon-blue">{c.authorName}</Link>
            </p>
            {c.evidenceLinks && <p className="mt-2 whitespace-pre-line break-words text-sm text-foreground/85">{c.evidenceLinks}</p>}
            {c.contactEmail && <p className="mt-1 text-sm text-foreground/85">Contact: {c.contactEmail}</p>}
            {c.message && <p className="mt-1 whitespace-pre-line text-sm text-muted">{c.message}</p>}
            <p className="mt-1 text-xs text-muted">{c.createdAt}</p>
            <div className="mt-3 flex gap-2">
              <button disabled={isPending} onClick={() => run(() => adminReviewAuthorClaim(c.id, "approved"))} className="btn-lime px-4 py-1.5 text-xs">
                Approve
              </button>
              <button
                disabled={isPending}
                onClick={() => {
                  const reason = window.prompt("Reason (shown to them, optional):") ?? undefined;
                  run(() => adminReviewAuthorClaim(c.id, "rejected", reason));
                }}
                className="btn-glass px-4 py-1.5 text-xs"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="section-heading text-lg">Link an account yourself</h2>
        <p className="text-sm text-muted">When you already know an account is the author&apos;s.</p>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="@username" className="field-glass px-4 text-sm" />
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Author page slug, e.g. melody-faith" className="field-glass px-4 text-sm" />
          <button
            disabled={isPending || !username || !author}
            onClick={() => run(async () => {
              const r = await adminLinkAuthorAccount(username, author.replace(/^.*\/author\//, "").trim(), note);
              if (r.success) { setUsername(""); setAuthor(""); setNote(""); }
              return r;
            })}
            className="btn-lime px-5 py-2.5 text-sm"
          >
            Link
          </button>
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="How you know (optional, internal)" className="field-glass w-full px-4 text-sm" />
      </section>

      <section className="space-y-3">
        <h2 className="section-heading text-lg">Verified authors ({approved.length})</h2>
        {approved.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3 rounded-[18px] border border-foreground/10 bg-surface/70 px-4 py-3 backdrop-blur-md">
            <p className="min-w-0 text-sm">
              <Link href={`/author/${c.authorSlug ?? c.authorId}`} className="font-semibold text-neon-blue">{c.authorName}</Link>
              {" · "}
              <Link href={c.username ? `/u/${c.username}` : "#"} className="text-neon-blue">{c.username ? `@${c.username}` : who(c)}</Link>
              <span className="text-muted"> · {c.method === "staff" ? "linked by staff" : "claimed"}</span>
            </p>
            <button
              disabled={isPending}
              onClick={() => window.confirm(`Remove ${who(c)}'s verified author status for ${c.authorName}?`) && run(() => adminReviewAuthorClaim(c.id, "revoked"))}
              className="btn-glass flex-shrink-0 px-3 py-1 text-xs"
            >
              Revoke
            </button>
          </div>
        ))}
      </section>

      <section className="space-y-3">
        <h2 className="section-heading text-lg">Author edits</h2>
        {edits.length === 0 && <p className="text-sm text-muted">No author edits yet.</p>}
        {edits.map((e) => (
          <div key={e.id} className="rounded-[18px] border border-foreground/10 bg-surface/70 p-4 backdrop-blur-md">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm text-foreground">
                <span className="font-semibold">{who(e)}</span>{" "}
                {e.kind === "description" ? "replaced the description of" : e.kind === "rating_confirm" ? `confirmed ${e.categoryName} on` : `changed ${e.categoryName} on`}{" "}
                <Link href={`/book/${e.bookSlug ?? ""}`} className="font-semibold text-neon-blue">{e.bookTitle}</Link>
                <span className="block text-xs text-muted">{e.createdAt}{e.revertedAt ? ` · reverted ${e.revertedAt}` : ""}</span>
              </p>
              {!e.revertedAt && e.kind !== "rating_confirm" && (
                <button
                  disabled={isPending}
                  onClick={() => window.confirm("Put back what this edit replaced?") && run(() => adminRevertAuthorEdit(e.id))}
                  className="btn-glass flex-shrink-0 px-3 py-1 text-xs"
                >
                  Revert
                </button>
              )}
            </div>
            {e.kind === "rating_edit" && (
              <p className="mt-2 text-xs text-muted">
                {LEVELS[e.beforeIntensity ?? 0]} → <span className="text-foreground">{LEVELS[e.afterIntensity ?? 0]}</span>
              </p>
            )}
            {e.kind !== "rating_confirm" && (
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer text-neon-blue">Before / after</summary>
                <p className="mt-2 whitespace-pre-line text-muted"><span className="font-semibold text-foreground">Before: </span>{e.beforeText || "(empty)"}</p>
                <p className="mt-2 whitespace-pre-line text-foreground/90"><span className="font-semibold">After: </span>{e.afterText || "(empty)"}</p>
              </details>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
