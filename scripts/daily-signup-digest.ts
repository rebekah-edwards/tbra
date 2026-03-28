/**
 * daily-signup-digest.ts — Send a single daily email with all new signups from the last 24 hours.
 *
 * Called by the nightly enrichment task. Uses Resend via the sendSignupDigestEmail function.
 *
 * Usage: npx tsx scripts/daily-signup-digest.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@libsql/client";
import { sendSignupDigestEmail } from "../src/lib/email";

const TURSO_URL = process.env.TURSO_DATABASE_URL;
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN;

const db = TURSO_URL
  ? createClient({ url: TURSO_URL, authToken: TURSO_TOKEN })
  : createClient({ url: "file:data/tbra.db" });

async function main() {
  // Get signups from the last 24 hours
  const rows = await db.execute(
    `SELECT email, display_name, email_verified, created_at
     FROM users
     WHERE created_at >= datetime('now', '-1 day')
     ORDER BY created_at DESC`
  );

  if (rows.rows.length === 0) {
    console.log("No new signups in the last 24 hours.");
    return;
  }

  const signups = rows.rows.map((r) => ({
    email: r.email as string,
    displayName: r.display_name as string | null,
    createdAt: r.created_at as string,
    verified: Boolean(r.email_verified),
  }));

  console.log(`Sending digest for ${signups.length} new signup(s)...`);
  const result = await sendSignupDigestEmail(signups);

  if (result.success) {
    console.log("Digest sent successfully.");
  } else {
    console.error("Failed to send digest:", result.error);
  }
}

main().catch(console.error);
