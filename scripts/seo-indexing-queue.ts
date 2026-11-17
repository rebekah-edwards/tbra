/**
 * seo-indexing-queue — the work list for the daily `seo-request-indexing` task.
 *
 * Google Search Console lets a site owner ask for ~10 URLs a day to be
 * (re)crawled through URL Inspection → "Request indexing". There is no API for
 * it, so a Claude scheduled task drives the Search Console page in Chrome and
 * uses this script for the two things that need no judgment: choosing the next
 * URLs and remembering what was already asked for.
 *
 *   npx tsx scripts/seo-indexing-queue.ts next [--limit=10]
 *       Prints JSON: the next URLs to submit, strongest first. Every URL is
 *       fetched as Googlebot first and only listed if it answers 200, declares
 *       itself canonical and carries no noindex — never spend quota on a page
 *       Google would refuse anyway.
 *   npx tsx scripts/seo-indexing-queue.ts mark <slug> <requested|indexed|failed> [note]
 *       Records the outcome so the URL is not offered again.
 *   npx tsx scripts/seo-indexing-queue.ts status
 *       Counts + the most recent entries.
 *
 * Ranking: books in the SEO core set (`seo_index_books`), ordered by written
 * reader reviews, then by readers who shelved it. Those are the pages with
 * content no other site has, which is the whole argument for indexing them.
 *
 * State lives in data/seo-index-requests.json (gitignored, local only). The
 * only thing this script writes to Turso is its own stall alert (see `next`).
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import fs from "fs";
import path from "path";
import { createGuardedTurso } from "./lib/turso-guard";
import { fileAdminAlert, resolveAdminAlert } from "./lib/admin-alert";

const BASE_URL = "https://thebasedreader.app";
const STATE_FILE = path.join(process.cwd(), "data", "seo-index-requests.json");
const GOOGLEBOT_UA = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
/** A review shorter than this is a star rating with a few words, not content. */
const MIN_REVIEW_CHARS = 80;
/** Stop live-checking after this many rejects so a bad day cannot hammer prod. */
const MAX_LIVE_CHECKS = 60;
/** File an /admin/issues alert once nothing has been recorded for this long. */
const STALL_DAYS = 3;

type Status = "requested" | "indexed" | "failed";
interface Entry { status: Status; date: string; note?: string }
type State = Record<string, Entry>;

function loadState(): State {
  if (!fs.existsSync(STATE_FILE)) return {};
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) as State;
}

function saveState(state: State) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, STATE_FILE);
}

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** Fetch the page the way Google does and decide whether it is worth submitting. */
async function liveCheck(url: string): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "user-agent": GOOGLEBOT_UA },
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    return `fetch failed: ${(err as Error).message}`;
  }
  if (res.status !== 200) return `HTTP ${res.status}`;
  const html = await res.text();
  const head = html.split("</head>")[0] ?? "";
  if (/<meta[^>]+name="robots"[^>]*noindex/i.test(head)) return "noindex";
  const canonical = head.match(/rel="canonical" href="([^"]*)"/)?.[1];
  if (canonical !== url) return `canonical is ${canonical ?? "missing"}`;
  return null;
}

async function next(limit: number) {
  const state = loadState();
  const { remote, shutdown } = await createGuardedTurso({
    name: "seo-indexing-queue",
    maxRuntimeMs: 10 * 60 * 1000,
    queryTimeoutMs: 60_000,
  });

  const core = await remote.execute(
    `SELECT s.book_id AS id, b.slug AS slug, b.title AS title
     FROM seo_index_books s JOIN books b ON b.id = s.book_id`,
  );
  const reviews = await remote.execute({
    sql: `SELECT book_id, COUNT(*) AS n FROM user_book_reviews
          WHERE review_text IS NOT NULL AND LENGTH(TRIM(review_text)) >= ?
          GROUP BY book_id`,
    args: [MIN_REVIEW_CHARS],
  });
  const readers = await remote.execute(
    `SELECT book_id, COUNT(*) AS n FROM user_book_state WHERE state IS NOT NULL GROUP BY book_id`,
  );

  // Nobody reads a scheduled task's output, so a run that keeps achieving
  // nothing (Chrome signed out of Google, extension disconnected) has to raise
  // its own flag. Every healthy day records at least one outcome.
  const lastProgress = Object.values(state).map((e) => e.date).sort().pop();
  const idleDays = lastProgress
    ? Math.floor((Date.parse(today()) - Date.parse(lastProgress)) / 86_400_000)
    : 0;
  const alert = { tag: "seo-request-indexing", key: "stalled" };
  if (idleDays >= STALL_DAYS) {
    await fileAdminAlert(remote, {
      ...alert,
      description:
        `No page has been submitted to Google for ${idleDays} days (last: ${lastProgress}). ` +
        `The daily seo-request-indexing task drives Search Console in Chrome — check that Chrome is open, ` +
        `the Claude extension is connected and the Google account is signed in.`,
    });
  } else {
    await resolveAdminAlert(remote, { ...alert, resolution: `Submissions resumed (${lastProgress}).` });
  }
  shutdown();

  const reviewCount = new Map(reviews.rows.map((r) => [String(r.book_id), Number(r.n)]));
  const readerCount = new Map(readers.rows.map((r) => [String(r.book_id), Number(r.n)]));

  const ranked = core.rows
    .map((r) => ({
      slug: String(r.slug),
      title: String(r.title),
      reviews: reviewCount.get(String(r.id)) ?? 0,
      readers: readerCount.get(String(r.id)) ?? 0,
    }))
    .filter((b) => b.slug && !state[b.slug])
    .sort((a, b) => b.reviews - a.reviews || b.readers - a.readers || a.slug.localeCompare(b.slug));

  const urls: Array<{ url: string; slug: string; title: string; reviews: number; readers: number }> = [];
  const rejected: Array<{ slug: string; reason: string }> = [];
  let checks = 0;
  for (const book of ranked) {
    if (urls.length >= limit || checks >= MAX_LIVE_CHECKS) break;
    checks++;
    const url = `${BASE_URL}/book/${book.slug}`;
    const problem = await liveCheck(url);
    if (problem) rejected.push({ slug: book.slug, reason: problem });
    else urls.push({ url, ...book });
  }

  console.log(JSON.stringify({ date: today(), urls, rejected, remainingInQueue: ranked.length - urls.length }, null, 2));
}

function mark(slug: string, status: string, note?: string) {
  if (!slug || !["requested", "indexed", "failed"].includes(status)) {
    console.error("usage: mark <slug> <requested|indexed|failed> [note]");
    process.exit(1);
  }
  const state = loadState();
  // Accept a full URL as well as a bare slug — the task copies from the page.
  const key = slug.replace(/^https?:\/\/[^/]+\/book\//, "").replace(/\/$/, "");
  state[key] = { status: status as Status, date: today(), ...(note ? { note } : {}) };
  saveState(state);
  console.log(`marked ${key} = ${status}`);
}

function status() {
  const state = loadState();
  const counts: Record<string, number> = {};
  for (const e of Object.values(state)) counts[e.status] = (counts[e.status] ?? 0) + 1;
  const recent = Object.entries(state)
    .sort((a, b) => b[1].date.localeCompare(a[1].date))
    .slice(0, 15)
    .map(([slug, e]) => ({ slug, ...e }));
  console.log(JSON.stringify({ total: Object.keys(state).length, counts, recent }, null, 2));
}

(async () => {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "next") {
    const limitArg = rest.find((a) => a.startsWith("--limit="));
    const limit = Math.min(Math.max(Number(limitArg?.split("=")[1] ?? 10) || 10, 1), 20);
    await next(limit);
  } else if (cmd === "mark") {
    mark(rest[0], rest[1], rest.slice(2).join(" ") || undefined);
  } else if (cmd === "status") {
    status();
  } else {
    console.error("usage: seo-indexing-queue.ts next [--limit=N] | mark <slug> <status> [note] | status");
    process.exit(1);
  }
  process.exit(0);
})();
