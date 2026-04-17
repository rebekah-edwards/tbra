/**
 * One-off: scan production up_next and re-number every user's rows
 * to be strictly 1..N with no gaps, preserving visual order by
 * existing position. Safe to run repeatedly (idempotent).
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.vercel.local" });
import { createClient } from "@libsql/client";

const client = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const { rows: allRows } = await client.execute(
  `SELECT id, user_id, position FROM up_next ORDER BY user_id, position`,
);

// Group by user_id
const byUser = new Map<string, { id: string; position: number }[]>();
for (const r of allRows) {
  const uid = String(r.user_id);
  const arr = byUser.get(uid) ?? [];
  arr.push({ id: String(r.id), position: Number(r.position) });
  byUser.set(uid, arr);
}

let fixed = 0;
for (const [userId, rows] of byUser) {
  rows.sort((a, b) => a.position - b.position);
  const needsFix = rows.some((r, i) => r.position !== i + 1);
  if (!needsFix) continue;

  console.log(`User ${userId}: [${rows.map((r) => r.position).join(", ")}] → [${rows.map((_, i) => i + 1).join(", ")}]`);

  // Phase 1: negative positions
  for (let i = 0; i < rows.length; i++) {
    await client.execute({
      sql: `UPDATE up_next SET position = ? WHERE id = ?`,
      args: [-(i + 1), rows[i].id],
    });
  }
  // Phase 2: contiguous positive positions
  for (let i = 0; i < rows.length; i++) {
    await client.execute({
      sql: `UPDATE up_next SET position = ? WHERE id = ?`,
      args: [i + 1, rows[i].id],
    });
  }
  fixed += 1;
}

console.log(`\nRepaired ${fixed} user(s). Total users with up_next rows: ${byUser.size}.`);
