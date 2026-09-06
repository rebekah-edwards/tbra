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
import { fileAdminAlert } from "./lib/admin-alert";
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

  // This filter MUST match src/app/sitemap-index.xml/route.ts exactly. It used to
  // be a bare `visibility = 'public'` count, which is a much larger number than the
  // set actually indexed (80,184 public vs 71,378 indexable on 2026-09-06) — so the
  // alert fired on 5K boundaries that did NOT correspond to a new /sitemap-books/N
  // page, sending Rebekah to GSC to submit a sitemap that did not exist. Counting
  // the indexable set means a crossing always equals exactly one new page.
  const { rows } = await client.execute(
    `SELECT count(*) as n FROM books b
      WHERE b.visibility = 'public'
        AND b.slug IS NOT NULL
        AND EXISTS (SELECT 1 FROM book_category_ratings r WHERE r.book_id = b.id)`,
  );
  const current = Number((rows[0] as any).n);

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
    const newPage = currThreshold / THRESHOLD_STEP + 1;
    const newPageUrl = `https://thebasedreader.app/sitemap-books/${newPage}`;
    const msg = `# Sitemap threshold crossed — ${date}

Indexable book count on Turso (public + has slug + has content ratings — the same
filter \`/sitemap-index.xml\` uses) crossed a 5K threshold:

- Previous run: **${previous.toLocaleString()}**
- Current:     **${current.toLocaleString()}**
- New bucket:  **${currThreshold.toLocaleString()}+**

This means exactly one new book sitemap now exists: **/sitemap-books/${newPage}**

## Next steps
1. Confirm it is generating: ${newPageUrl} (should return <loc> entries, not an empty urlset)
2. Submit that URL in Google Search Console: https://search.google.com/search-console
3. The index at https://thebasedreader.app/sitemap-index.xml picks it up automatically.

Submitting keeps Google's crawl budget aligned with the catalog size.
`;
    fs.writeFileSync(reportFile, msg);
    console.log(`[sitemap-threshold] ALERT: crossed ${currThreshold.toLocaleString()} — wrote ${reportFile}`);

    // Runs under launchd (com.tbra.sitemap-threshold) as of 2026-07-30, so
    // nobody reads this stdout. A crossing needs a manual GSC submission, so it
    // has to reach /admin/issues to be seen at all.
    const filed = await fileAdminAlert(client, {
      tag: "sitemap-threshold",
      key: String(currThreshold),
      description:
        `Indexable book count crossed ${currThreshold.toLocaleString()} (${previous.toLocaleString()} → ${current.toLocaleString()}). `
        + `New sitemap ${newPageUrl} now exists — submit that URL in Google Search Console. `
        + `Details: reports/sitemap-threshold-${date}.md`,
    });
    console.log(
      filed
        ? `[sitemap-threshold] filed /admin/issues alert for the ${currThreshold.toLocaleString()} bucket`
        : `[sitemap-threshold] an open alert for this bucket already exists — not duplicating`,
    );
  } else {
    console.log(`[sitemap-threshold] No threshold crossing this run.`);
  }

  shutdown();

  fs.writeFileSync(
    STATE_FILE,
    JSON.stringify({ count: current, checkedAt: new Date().toISOString() }, null, 2),
  );
}

main().catch((e) => {
  console.error("[sitemap-threshold] FATAL", e);
  process.exit(1);
});
