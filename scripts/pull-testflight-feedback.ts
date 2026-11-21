/**
 * Bridge TestFlight beta feedback (App Store Connect) into reported_issues
 * on prod Turso, so the nightly triage sees it alongside in-app reports.
 *
 * - Pulls betaFeedbackScreenshotSubmissions AND betaFeedbackCrashSubmissions
 *   (all pages) through native-ios/asc-api.mjs. Crash items are prefixed
 *   "CRASH:" and their crash log is saved as data/testflight-feedback/<id>-crash.txt.
 * - Dedupe: each imported row's description starts with "[TestFlight tf:<id>]"
 *   — existing markers are skipped, so re-runs are idempotent.
 * - Screenshots: signed URLs expire ~1 week; they're saved to
 *   data/testflight-feedback/ locally AND the URLs included in the report.
 *
 * Run nightly ahead of process-reports.ts (nightly-report-triage task).
 */
import { config } from "dotenv";
config({ path: ".env.vercel.local" });

import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { createGuardedTurso } from "./lib/turso-guard";

const APP_ID = "6791708808";
// reported_issues.user_id is NOT NULL: attribute to the tester's account
// when their TestFlight email matches a user; otherwise file under Rebekah.
const FALLBACK_USER_ID = "c2f3eb27-139f-4605-9566-8ded8d9e1336";
const ASC_HELPER = path.join(__dirname, "..", "native-ios", "asc-api.mjs");
const SHOT_DIR = path.join(__dirname, "..", "data", "testflight-feedback");

(async () => {
  const { remote } = await createGuardedTurso({
    name: "pull-testflight-feedback",
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  // stderr piped, not inherited: a crash item with no crash log is a normal
  // 404 and should not print a stack trace into the nightly output.
  const ascGet = (p: string) => JSON.parse(execFileSync("node", [ASC_HELPER, "get", p],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }));
  // Follow links.next: the API pages, and a single fixed-limit call would
  // silently drop everything past the first page.
  const fetchAll = (first: string) => {
    const out: any[] = [];
    let next: string | null = first;
    while (next) {
      const page = ascGet(next);
      out.push(...(page.data ?? []));
      next = page.links?.next ? String(page.links.next).replace("https://api.appstoreconnect.apple.com", "") : null;
    }
    return out;
  };

  // Two kinds of tester feedback: from a screenshot, and from the "the app
  // crashed, tell us what happened" prompt. The crash kind was not pulled until
  // 2026-11-21, so two July crash comments never reached the queue.
  const feedback = [
    ...fetchAll(`/v1/apps/${APP_ID}/betaFeedbackScreenshotSubmissions?limit=200`).map((f) => ({ ...f, kind: "screenshot" })),
    ...fetchAll(`/v1/apps/${APP_ID}/betaFeedbackCrashSubmissions?limit=200`).map((f) => ({ ...f, kind: "crash" })),
  ];
  console.log(`TestFlight feedback items: ${feedback.length} (${feedback.filter((f) => f.kind === "crash").length} crash)`);

  fs.mkdirSync(SHOT_DIR, { recursive: true });
  let imported = 0, skipped = 0;

  for (const item of feedback) {
    const marker = `[TestFlight tf:${item.id}]`;
    const existing = await remote.execute({
      sql: "SELECT id FROM reported_issues WHERE description LIKE ? LIMIT 1",
      args: [`${marker}%`],
    });
    if (existing.rows.length > 0) { skipped++; continue; }

    const a = item.attributes;
    const shots: string[] = (a.screenshots ?? []).map((s: any) => s.url);

    // Local backup of screenshots (signed URLs expire ~1 week)
    for (let i = 0; i < shots.length; i++) {
      const dest = path.join(SHOT_DIR, `${item.id}-${i + 1}.jpg`);
      if (!fs.existsSync(dest)) {
        try {
          execFileSync("curl", ["-s", "-o", dest, shots[i]], { timeout: 30_000 });
        } catch { /* screenshot backup is best-effort */ }
      }
    }

    // Crash feedback: keep the crash log locally (the comment alone rarely
    // says where it crashed). Best-effort, like the screenshots.
    let crashLogFile: string | null = null;
    if (item.kind === "crash") {
      const dest = path.join(SHOT_DIR, `${item.id}-crash.txt`);
      try {
        if (!fs.existsSync(dest)) {
          const log = ascGet(`/v1/betaFeedbackCrashSubmissions/${item.id}/crashLog`);
          fs.writeFileSync(dest, String(log.data?.attributes?.logText ?? ""));
        }
        crashLogFile = `data/testflight-feedback/${item.id}-crash.txt`;
      } catch { /* crash log backup is best-effort */ }
    }

    // (The feedback's build relationship is not readable via the API: 403
    // "no allowed operations". The crash log's Version line carries it.)
    const parts = [
      `${marker} ${item.kind === "crash" ? "CRASH: " : ""}${a.comment ?? "(no comment)"}`,
      `— via TestFlight ${a.createdDate?.slice(0, 10)}, tester ${a.email ?? "unknown"}, ${a.deviceModel} iOS ${a.osVersion}`,
    ];
    if (crashLogFile) parts.push(`Crash log: ${crashLogFile}`);
    if (shots.length) {
      parts.push(`Screenshots (URLs expire ~1wk; local backup data/testflight-feedback/${item.id}-*.jpg): ${shots.join(" ")}`);
    }

    let userId = FALLBACK_USER_ID;
    if (a.email) {
      const u = await remote.execute({
        sql: "SELECT id FROM users WHERE email = ? COLLATE NOCASE LIMIT 1",
        args: [a.email],
      });
      if (u.rows.length > 0) userId = u.rows[0].id as string;
    }

    await remote.execute({
      sql: `INSERT INTO reported_issues (id, user_id, book_id, series_id, page_url, description, status, created_at)
            VALUES (?, ?, NULL, NULL, ?, ?, 'new', ?)`,
      args: [randomUUID(), userId, "testflight-feedback", parts.join("\n"), (a.createdDate ?? new Date().toISOString()).replace("T", " ").slice(0, 19)],
    });
    imported++;
    console.log(`  imported ${item.id}: ${(a.comment ?? "").slice(0, 70).replace(/\n/g, " ")}`);
  }

  console.log(`DONE — imported ${imported}, already-present ${skipped}`);
  process.exit(0);
})().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
