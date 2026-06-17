/**
 * One-off: restore the handful of books that the (aborted) NYT-regression backfill
 * re-enriched while the Brave API key was invalid — which produced research-free,
 * sometimes-thinner ratings. Turso was never pushed, so it still holds the originals.
 * Reads Turso (read-only), overwrites the matching LOCAL rows.
 */
import * as fs from "fs";
import * as path from "path";
import { createClient } from "@libsql/client";

function loadEnv(file: string) {
  const p = path.join(process.cwd(), file);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i);
    let v = t.slice(i + 1);
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    process.env[k] = v;
  }
}
loadEnv(".env.vercel.local");

const IDS = [
  "8af8eef1-a499-44a4-980a-4e185b9fd37a",
  "74d7bac1-0f9a-421d-a643-a325c0470f6f",
  "2fc84527-4133-48e2-a125-b55472746c22",
  "c5d2d144-1281-4b91-81ed-47339456b202",
  "8cb0170b-7d43-4735-b6f1-c198a5cf59dc",
  "4cc5f22a-4e97-45fd-846c-13802b0e204c",
];

(async () => {
  const remote = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });
  const local = createClient({ url: "file:data/tbra.db" });

  for (const id of IDS) {
    const b = await remote.execute({
      sql: "SELECT summary, description, description_stale, is_fiction, pacing, updated_at FROM books WHERE id = ?",
      args: [id],
    });
    if (b.rows.length === 0) {
      console.warn(`[restore] ${id} not on Turso — skipping`);
      continue;
    }
    const r = b.rows[0] as Record<string, unknown>;
    await local.execute({
      sql: "UPDATE books SET summary=?, description=?, description_stale=?, is_fiction=?, pacing=?, updated_at=? WHERE id=?",
      args: [
        (r.summary as string) ?? null,
        (r.description as string) ?? null,
        (r.description_stale as number) ?? 0,
        (r.is_fiction as number) ?? null,
        (r.pacing as string) ?? null,
        (r.updated_at as string) ?? new Date().toISOString(),
        id,
      ],
    });

    const ratings = await remote.execute({
      sql: "SELECT id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at FROM book_category_ratings WHERE book_id = ?",
      args: [id],
    });
    await local.execute({ sql: "DELETE FROM book_category_ratings WHERE book_id = ?", args: [id] });
    for (const row of ratings.rows as unknown as Record<string, unknown>[]) {
      await local.execute({
        sql: "INSERT INTO book_category_ratings (id, book_id, category_id, intensity, notes, evidence_level, updated_by_user_id, updated_at) VALUES (?,?,?,?,?,?,?,?)",
        args: [
          row.id as string, row.book_id as string, row.category_id as string,
          row.intensity as number, (row.notes as string) ?? null,
          row.evidence_level as string, (row.updated_by_user_id as string) ?? null,
          (row.updated_at as string) ?? new Date().toISOString(),
        ],
      });
    }
    const nz = (ratings.rows as unknown as { intensity: number }[]).filter((x) => x.intensity > 0).length;
    console.log(`[restore] ${id} restored (${ratings.rows.length} ratings, ${nz} nonzero).`);
  }
  console.log("[restore] Done.");
  process.exit(0);
})();
