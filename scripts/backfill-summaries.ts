import { db } from "@/db";
import { books } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { readFileSync } from "fs";
import OpenAI from "openai";

// Load env
const envFile = readFileSync(".env.local", "utf8");
for (const line of envFile.split("\n")) {
  const m = line.match(/^([^#=]+)=(.*)$/);
  if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, "");
}

const client = new OpenAI({
  baseURL: "https://api.x.ai/v1",
  apiKey: process.env.XAI_API_KEY!,
});

function truncateSummary(text: string, max: number): string {
  if (text.length <= max) return text;
  const truncated = text.slice(0, max + 1);
  const lastEnd = Math.max(
    truncated.lastIndexOf(". "),
    truncated.lastIndexOf(".\u201D"),
    truncated.lastIndexOf(".\"")
  );
  if (lastEnd > max * 0.5) return truncated.slice(0, lastEnd + 1).trim();
  // Fall back to last space
  const lastSpace = truncated.lastIndexOf(" ");
  return truncated.slice(0, lastSpace).trim().replace(/[,;:\-—]$/, "") + "...";
}

async function generateSummary(title: string, description: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await client.chat.completions.create(
      {
        model: "grok-3-mini",
        messages: [
          {
            role: "user",
            content: `Write a 1-2 sentence summary (max 190 characters) for this book. The summary should be a concise, engaging hook — not a plot synopsis. Do NOT reference reviews, sources, or research. Write as if you've read the book.

Title: ${title}
Description: ${description}

Respond with ONLY the summary text, nothing else.`,
          },
        ],
        temperature: 0.3,
      },
      { signal: controller.signal }
    );
    clearTimeout(timeout);

    let summary = response.choices?.[0]?.message?.content?.trim() ?? null;
    if (!summary) return null;

    // Strip quotes if the AI wrapped it
    summary = summary.replace(/^["']|["']$/g, "").trim();

    // Enforce 190-char limit
    if (summary.length > 190) {
      summary = truncateSummary(summary, 190);
    }

    // Reject garbage
    if (summary.length < 20) return null;
    if (/no\s+(information|data|summary|description)/i.test(summary)) return null;
    if (/sources?\s+(confirm|mention|indicate)/i.test(summary)) return null;

    return summary;
  } catch (err: any) {
    clearTimeout(timeout);
    throw err;
  }
}

async function main() {
  const candidates = await db
    .select({ id: books.id, title: books.title, description: books.description })
    .from(books)
    .where(
      sql`${books.description} IS NOT NULL AND length(${books.description}) > 0 AND (${books.summary} IS NULL OR length(${books.summary}) = 0)`
    )
    .all();

  console.log(`[backfill] Found ${candidates.length} books needing summaries`);

  let ok = 0, failed = 0, skipped = 0;

  for (let i = 0; i < candidates.length; i++) {
    const book = candidates[i];
    try {
      const summary = await generateSummary(book.title, book.description!);
      if (summary) {
        await db.update(books).set({ summary, updatedAt: new Date().toISOString() }).where(eq(books.id, book.id));
        ok++;
      } else {
        skipped++;
      }
    } catch (err: any) {
      failed++;
      console.error(`[backfill] Failed on "${book.title}": ${err.message}`);
      // Rate limit — back off
      if (err.status === 429) {
        console.log("[backfill] Rate limited, waiting 30s...");
        await new Promise(r => setTimeout(r, 30000));
      }
    }

    if ((i + 1) % 50 === 0) {
      console.log(`[backfill] Progress: ${i + 1}/${candidates.length} (${ok} ok, ${skipped} skipped, ${failed} failed)`);
    }
  }

  console.log(`[backfill] DONE: ${candidates.length} total, ${ok} summaries written, ${skipped} skipped, ${failed} failed`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
