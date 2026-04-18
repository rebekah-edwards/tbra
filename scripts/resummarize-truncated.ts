/**
 * resummarize-truncated.ts
 *
 * One-off (or repeatable) fix for books whose `summary` got truncated
 * mid-sentence with "..." or "…" by an old character-cap pass.
 *
 * Strategy: re-summarize from the book's description using Grok, same
 * model that writes summaries in the enrichment pipeline (analyze.ts).
 *
 * Safeguards:
 *   - Only touches books where summary ends in "..." or "…"
 *   - Only touches books where description length >= 150 (enough material
 *     to derive a summary)
 *   - Grok call has a 60s timeout and 429/402/403 pause triggers
 *   - On any Grok error, book is skipped (leaves old truncated summary
 *     in place) — never clears a good summary on failure
 *
 * Run: npx tsx scripts/resummarize-truncated.ts [--limit N] [--dry-run]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import Database from "better-sqlite3";
import path from "path";
import OpenAI from "openai";

const DB_PATH = path.join(process.cwd(), "data", "tbra.db");
const db = new Database(DB_PATH);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const limitArg = args.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? Number(limitArg.split("=")[1]) : 1000;

const MAX_DESC_CHARS = 2500; // truncate very long descriptions for cost control
const DELAY_BETWEEN_CALLS_MS = 500;

type Row = {
  id: string;
  title: string;
  summary: string;
  description: string;
  author_names: string | null;
};

function getBooks(): Row[] {
  return db
    .prepare(
      `SELECT b.id, b.title, b.summary, b.description,
              (SELECT group_concat(a.name, ', ')
               FROM book_authors ba
               JOIN authors a ON a.id = ba.author_id
               WHERE ba.book_id = b.id) as author_names
       FROM books b
       WHERE b.visibility = 'public'
         AND (b.summary LIKE '%...' OR b.summary LIKE '%…')
         AND b.description IS NOT NULL
         AND length(b.description) >= 150
       ORDER BY b.updated_at DESC
       LIMIT ?`,
    )
    .all(LIMIT) as Row[];
}

function buildPrompt(book: Row): string {
  const desc =
    book.description.length > MAX_DESC_CHARS
      ? book.description.slice(0, MAX_DESC_CHARS) + "…"
      : book.description;
  const author = book.author_names || "Unknown Author";
  return `Write a concise, spoiler-free summary of the following book in 2-3 sentences (target 220-300 characters). Use third person, active voice. Do NOT quote the book's marketing copy — rewrite in plain descriptive prose. Do NOT start with phrases like "In this book" or "This novel tells". Do NOT end with an ellipsis. End with a period.

Title: ${book.title}
Author: ${author}

Book description:
${desc}

Summary:`;
}

async function callGrok(client: OpenAI, prompt: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);
  try {
    const res = await client.chat.completions.create(
      {
        model: "grok-3",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3,
      },
      { signal: controller.signal },
    );
    clearTimeout(timeout);
    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error("Empty Grok response");
    return content.trim();
  } catch (err: any) {
    clearTimeout(timeout);
    const status = err?.status;
    if (status === 429 || status === 402 || status === 403) {
      const e = new Error(`Grok API exhausted (${status})`);
      (e as any).code = "API_EXHAUSTED";
      throw e;
    }
    throw err;
  }
}

function cleanSummary(raw: string): string {
  // Strip surrounding quotes, code fences, leading "Summary:" label
  let s = raw
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .replace(/^Summary\s*:\s*/i, "")
    .replace(/^["'“”]|["'“”]$/g, "")
    .trim();
  // Collapse any lingering trailing ellipsis (defensive — prompt asks Grok not to)
  s = s.replace(/[…]+$/g, "").replace(/\.\.\.$/g, "").trim();
  // Ensure ends with sentence punctuation
  if (!/[.!?]$/.test(s)) s += ".";
  return s;
}

async function main() {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) {
    console.error("[resummarize] XAI_API_KEY not set");
    process.exit(1);
  }
  const client = new OpenAI({ baseURL: "https://api.x.ai/v1", apiKey });

  const rows = getBooks();
  console.log(`[resummarize] Found ${rows.length} candidate books (dry-run=${DRY_RUN})`);

  const update = db.prepare(
    `UPDATE books SET summary = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
  );

  let rewritten = 0;
  let skipped = 0;
  let failed = 0;
  const start = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (i % 25 === 0) {
      console.log(`  [${i}/${rows.length}] rewritten=${rewritten} failed=${failed} skipped=${skipped}`);
    }

    try {
      const raw = await callGrok(client, buildPrompt(r));
      const cleaned = cleanSummary(raw);

      if (cleaned.length < 80) {
        console.warn(`  SKIP too-short result for "${r.title}": "${cleaned}"`);
        skipped++;
        continue;
      }
      if (cleaned.length > 450) {
        console.warn(`  SKIP too-long result for "${r.title}" (${cleaned.length} chars)`);
        skipped++;
        continue;
      }
      if (/\.{3}$|…$/.test(cleaned)) {
        console.warn(`  SKIP still-truncated result for "${r.title}"`);
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        if (i < 5) {
          console.log(`\n--- DRY RUN: ${r.title} ---`);
          console.log(`  OLD (${r.summary.length}): ${r.summary.slice(0, 200)}${r.summary.length > 200 ? "..." : ""}`);
          console.log(`  NEW (${cleaned.length}): ${cleaned}`);
        }
      } else {
        update.run(cleaned, r.id);
      }
      rewritten++;
    } catch (e: any) {
      if (e?.code === "API_EXHAUSTED") {
        console.error(`[resummarize] API exhausted. Stopping early after ${i} books.`);
        break;
      }
      console.error(`  FAIL "${r.title}": ${e?.message || e}`);
      failed++;
    }

    await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CALLS_MS));
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(
    `\n[resummarize] Done in ${elapsed}s — rewritten=${rewritten} skipped=${skipped} failed=${failed}${DRY_RUN ? " (DRY RUN — no DB writes)" : ""}`,
  );
  if (!DRY_RUN && rewritten > 0) {
    console.log(`[resummarize] Follow-up: ./scripts/sync-incremental.sh push to propagate to Turso`);
  }
  db.close();
}

main().catch((e) => {
  console.error("[resummarize] FATAL", e);
  db.close();
  process.exit(1);
});
