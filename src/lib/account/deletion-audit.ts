import { createHash, randomUUID } from "crypto";
import { db } from "@/db";
import { sql } from "drizzle-orm";

/**
 * Account-deletion audit trail.
 *
 * Why this exists (2026-08-24): a tester's account vanished from production
 * between 2026-08-15 and 2026-08-17 and there was no way to tell whether they
 * deleted it themselves or a bug ate it. Answering that took a forensic sweep
 * of all 56 tables — the only surviving trace was one orphaned `discover_usage`
 * row, because that was the single table both delete paths forgot. There is no
 * log, no notification and no soft-delete anywhere, so "did the user do this?"
 * was very nearly unanswerable. This makes it answerable in one query.
 *
 * PRIVACY: the raw email is deliberately NOT stored. Someone who asked to be
 * erased should not have their address retained in a side table. The SHA-256
 * still answers the question that actually gets asked — "was this <person>?" —
 * by hashing a candidate address and comparing. The domain is kept as a coarse
 * signal, and the username was already public.
 *
 * The table has NO foreign key to `users` on purpose: the row is written just
 * before the user record is deleted and has to outlive it.
 */

export type DeletionSource = "web" | "ios";

export function hashEmail(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at === -1 ? null : email.slice(at + 1).toLowerCase();
}

/**
 * Record that an account was deleted. Call BEFORE the users row is removed.
 *
 * Best-effort by design: an audit failure must never block or roll back a
 * deletion the user explicitly asked for. Failures are logged, not thrown.
 */
export async function recordAccountDeletion(opts: {
  userId: string;
  email: string | null;
  username: string | null;
  source: DeletionSource;
  accountCreatedAt?: string | null;
  rowsDeleted?: number | null;
}): Promise<void> {
  try {
    const email = opts.email ?? "";
    await db.run(sql`
      INSERT INTO deleted_accounts
        (id, user_id, email_sha256, email_domain, username, source, account_created_at, deleted_at, rows_deleted)
      VALUES (
        ${randomUUID()},
        ${opts.userId},
        ${email ? hashEmail(email) : ""},
        ${email ? emailDomain(email) : null},
        ${opts.username ?? null},
        ${opts.source},
        ${opts.accountCreatedAt ?? null},
        ${new Date().toISOString()},
        ${opts.rowsDeleted ?? null}
      )`);
  } catch (err) {
    console.error("[deletion-audit] failed to record deletion", opts.userId, err);
  }
}
