import { createClient } from "@libsql/client";

async function main() {
  const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN! });
  const secret = "f0b279083a1587133e6ef0392228ed21";

  // Find all books in these series that lack covers
  const rows = await db.execute(
    `SELECT b.id, b.title, b.cover_image_url FROM books b
     INNER JOIN book_series bs ON b.id = bs.book_id
     INNER JOIN series s ON bs.series_id = s.id
     WHERE s.name IN ('All the Dust that Falls', 'Noobtown', 'New Realm Online')
       AND (b.cover_image_url IS NULL OR b.cover_image_url = '')`,
  );

  console.log(`Found ${rows.rows.length} books needing covers:`);
  for (const row of rows.rows) {
    console.log(`  "${row.title}" (${(row.id as string).slice(0, 8)}…)`);
  }

  if (rows.rows.length === 0) {
    console.log("Nothing to enrich!");
    return;
  }

  console.log(`\nTriggering enrichment for each…`);
  let triggered = 0;
  for (const row of rows.rows) {
    try {
      const res = await fetch("https://www.thebasedreader.app/api/enrichment/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-enrichment-secret": secret },
        body: JSON.stringify({ bookId: row.id }),
      });
      const json = await res.json();
      const status = json.skipped ? `skipped (${json.reason})` : "triggered";
      console.log(`  ✓ ${(row.title as string).slice(0, 40).padEnd(40)} ${status}`);
      triggered++;
      // Brief delay to avoid hammering the endpoint
      await new Promise((r) => setTimeout(r, 2000));
    } catch (err) {
      console.log(`  ✗ ${row.title}: ${err}`);
    }
  }
  console.log(`\nDone. Triggered ${triggered} enrichments.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
