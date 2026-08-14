import * as fs from "fs";
import * as path from "path";

// Load .env.local
const envPath = path.join(process.cwd(), ".env.local");
const envContent = fs.readFileSync(envPath, "utf8");
for (const line of envContent.split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx);
  let val = trimmed.slice(eqIdx + 1);
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  process.env[key] = val;
}
// Force enrichment on for single-book runs
process.env.ENRICHMENT_PAUSED = "false";

import { enrichBook } from "../src/lib/enrichment/enrich-book";

// --brave runs the FULL path (Brave content searches + Grok) instead of the
// free structured sources only. Needed when the free cascade keeps returning
// the same junk: OpenLibrary/ISBNdb sometimes hold a used-bookseller condition
// report or a storefront blurb as the "description", and clearing the field
// locally just re-fetches the identical string. Costs ~6 Brave calls against
// the shared daily budget (see the Brave section in CLAUDE.md), so it is opt-in
// per book rather than the default.
const useBrave = process.argv.includes("--brave");
const bookId = process.argv.find((a) => !a.startsWith("--") && /^[0-9a-f-]{36}$/i.test(a))
  ?? "cdf75198-3d5d-4d4e-843c-dbc9cf659547";
console.log(`Enriching book: ${bookId}${useBrave ? "  [FULL: Brave + Grok]" : "  [free tiers only]"}`);
enrichBook(bookId, useBrave ? { skipBrave: false, skipContentSearch: false } : { skipBrave: true })
  .then((r) => {
    console.log("Done:", JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((e) => {
    console.error("Error:", e.message || e);
    process.exit(1);
  });
