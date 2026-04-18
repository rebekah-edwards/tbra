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

import { createClient } from "@libsql/client";
import fs from "fs";
import path from "path";

const REPORTS_DIR = path.join(process.cwd(), "reports");
const STATE_FILE = path.join(REPORTS_DIR, "sitemap-threshold-last.json");
const THRESHOLD_STEP = 5000;

async function main() {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const client = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  });

  const { rows } = await client.execute(
    `SELECT count(*) as n FROM books WHERE visibility = 'public'`,
  );
  const current = Number((rows[0] as any).n);
  client.close();

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

Book count on Turso (\`visibility = 'public'\`) crossed a 5K threshold:

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
