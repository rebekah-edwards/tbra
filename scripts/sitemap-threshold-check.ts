/**
 * sitemap-threshold-check
 *
 * Checks Turso book count and writes an alert report to
 * reports/sitemap-threshold-{date}.md when the count crosses a 5K boundary
 * since the previous run.
 *
 * State is tracked in reports/sitemap-threshold-last.json.
 * User sees the report file and decides whether to submit a new sitemap to GSC.
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import { createGuardedTurso } from "./lib/turso-guard";
import fs from "fs";
import path from "path";

const REPORTS_DIR = path.join(process.cwd(), "reports");
const STATE_FILE = path.join(REPORTS_DIR, "sitemap-threshold-last.json");
const THRESHOLD_STEP = 5000;

async function main() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const { remote: client, shutdown } = await createGuardedTurso({
    name: "sitemap-threshold-check",
    maxRuntimeMs: 5 * 60 * 1000,
    // The public-count query depends on idx_books_visibility (added 2026-06-22);
    // with the index it runs in ~340ms. The generous timeout is a backstop so a
    // future un-indexed/slow run fails loudly within the 5-min ceiling rather than
    // tripping a 30s guard and silently exiting (the bug that broke this nightly).
    queryTimeoutMs: 180_000,
  });

  // Must count exactly what /sitemap-index.xml pages on: countIndexableBooks()
  // in src/lib/seo/indexability.ts (the SEO core set, 2026-11-16). Counting
  // bare `visibility = 'public'` here once sent an alert for a sitemap page
  // that did not exist.
  const { rows } = await client.execute(
    `SELECT count(*) as n FROM seo_index_books x JOIN books b ON b.id = x.book_id
     WHERE b.visibility = 'public' AND b.slug IS NOT NULL`,
  );
  const current = Number((rows[0] as any).n);
  shutdown();

  let previous = 0;
  if (fs.existsSync(STATE_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      previous = Number(raw.count) || 0;
    } catch {
      /* ignore */
    }
  }

  const prevThreshold = Math.floor(previous / THRESHOLD_STEP) * THRESHOLD_STEP;
  const currThreshold = Math.floor(current / THRESHOLD_STEP) * THRESHOLD_STEP;

  console.log(
    `[sitemap-threshold] previous=${previous}  current=${current}  prev-bucket=${prevThreshold}  curr-bucket=${currThreshold}`,
  );

  if (currThreshold > prevThreshold) {
    const date = new Date().toISOString().slice(0, 10);
    const reportFile = path.join(REPORTS_DIR, `sitemap-threshold-${date}.md`);
    const msg = `# Sitemap threshold crossed — ${date}

Indexable book count on Turso (the SEO core set in \`seo_index_books\`) crossed a 5K threshold:

- Previous run: **${previous.toLocaleString()}**
- Current:     **${current.toLocaleString()}**
- New bucket:  **${currThreshold.toLocaleString()}+**

## Next steps
1. Check sitemap-books index pages at https://thebasedreader.app/sitemap-books/
2. If a new sub-sitemap is needed, confirm it's being generated.
3. Submit the updated sitemap index to Google Search Console:
   https://search.google.com/search-console

Submitting keeps Google's crawl budget aligned with the catalog size.
`;
    fs.writeFileSync(reportFile, msg);
    console.log(`[sitemap-threshold] ALERT: crossed ${currThreshold.toLocaleString()} — wrote ${reportFile}`);
  } else {
    console.log(`[sitemap-threshold] No threshold crossing this run.`);
  }

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ count: current, checkedAt: new Date().toISOString() }, null, 2),
  );
}

main().catch((e) => {
  console.error("[sitemap-threshold] FATAL", e);
  process.exit(1);
});
