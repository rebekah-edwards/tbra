/**
 * Fix truncated summaries — find books whose summary ends with "..." or "…"
 * and re-summarize them from their description text within 190 chars.
 *
 * Only processes books that have a description to work with.
 * Uses xAI (Grok) for re-summarization.
 *
 * Usage: npx tsx scripts/fix-truncated-summaries.ts [--dry-run]
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { db } from "../src/db";
import { books } from "../src/db/schema";
import { sql } from "drizzle-orm";

const DRY_RUN = process.argv.includes("--dry-run");
const DELAY_MS = 1000;
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function summarize(title: string, author: string | null, description: string): Promise<string> {
  const resp = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.XAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "grok-3-mini",
      messages: [
        {
          role: "system",
          content: `You write concise book summaries for a book tracking app. Rules:
- MUST be under 190 characters total (this is a hard limit, count carefully)
- Write a complete, self-contained summary that does NOT end with "..." or ellipsis
- End with a period, not a trailing thought
- Focus on the core premise/hook of the book
- Do not start with the title or "This book"
- Do not mention the author
- Write in present tense for fiction, appropriate tense for nonfiction`,
        },
        {
          role: "user",
          content: `Summarize "${title}"${author ? ` by ${author}` : ""} in under 190 characters:\n\n${description.slice(0, 1000)}`,
        },
      ],
      max_tokens: 100,
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    throw new Error(`xAI API error: ${resp.status} ${resp.statusText}`);
  }

  const data = await resp.json();
  let summary = data.choices?.[0]?.message?.content?.trim() ?? "";

  // Strip quotes if the model wrapped it
  if ((summary.startsWith('"') && summary.endsWith('"')) ||
      (summary.startsWith("'") && summary.endsWith("'"))) {
    summary = summary.slice(1, -1);
  }

  // Hard enforce 190 char limit
  if (summary.length > 190) {
    const lastSentenceEnd = Math.max(
      summary.slice(0, 191).lastIndexOf(". "),
      summary.slice(0, 191).lastIndexOf("? "),
      summary.slice(0, 191).lastIndexOf("! "),
      summary.endsWith(".") ? summary.length - 1 : -1,
    );
    if (lastSentenceEnd > 60) {
      summary = summary.slice(0, lastSentenceEnd + 1);
    } else {
      const lastSpace = summary.slice(0, 189).lastIndexOf(" ");
      summary = (lastSpace > 60 ? summary.slice(0, lastSpace) : summary.slice(0, 188)).replace(/[,;:\-–—]$/, "").trimEnd() + ".";
    }
  }

  return summary;
}

async function main() {
  // Find truncated summaries that have descriptions to re-summarize from
  const truncated = await db
    .select({
      id: books.id,
      title: books.title,
      summary: books.summary,
      description: books.description,
    })
    .from(books)
    .where(
      sql`(${books.summary} LIKE '%...' OR ${books.summary} LIKE '%…')
          AND ${books.description} IS NOT NULL
          AND LENGTH(${books.description}) > 50`
    );

  console.log(`[fix-summaries] Found ${truncated.length} truncated summaries with descriptions`);
  if (DRY_RUN) console.log("[fix-summaries] DRY RUN — no changes will be made\n");

  let fixed = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < truncated.length; i++) {
    const book = truncated[i];
    console.log(`\n[${i + 1}/${truncated.length}] ${book.title}`);
    console.log(`  OLD: ${book.summary}`);

    try {
      const newSummary = await summarize(book.title, null, book.description!);

      // Validate
      if (!newSummary || newSummary.length < 20) {
        console.log(`  SKIP: Generated summary too short (${newSummary?.length ?? 0} chars)`);
        skipped++;
        continue;
      }
      if (newSummary.endsWith("...") || newSummary.endsWith("…")) {
        console.log(`  SKIP: Generated summary still ends with ellipsis`);
        skipped++;
        continue;
      }
      if (newSummary.length > 190) {
        console.log(`  SKIP: Generated summary too long (${newSummary.length} chars)`);
        skipped++;
        continue;
      }

      console.log(`  NEW: ${newSummary} (${newSummary.length} chars)`);

      if (!DRY_RUN) {
        await db.update(books).set({ summary: newSummary }).where(sql`${books.id} = ${book.id}`);
      }
      fixed++;
    } catch (err: any) {
      console.log(`  ERROR: ${err.message}`);
      failed++;
    }

    await delay(DELAY_MS);
  }

  console.log(`\n[fix-summaries] Done! Fixed: ${fixed}, Skipped: ${skipped}, Failed: ${failed}`);
}

main().catch(console.error);
