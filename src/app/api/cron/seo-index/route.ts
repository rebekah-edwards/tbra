import { NextResponse } from "next/server";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { recomputeCoreSet } from "@/lib/seo/core-set";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

/** Turn `?`-placeholder SQL + args into a Drizzle SQL object with bound params. */
function bind(text: string, args: (string | number)[]): SQL {
  const parts = text.split("?");
  const chunks: SQL[] = [];
  parts.forEach((part, i) => {
    chunks.push(sql.raw(part));
    if (i < parts.length - 1) chunks.push(sql`${args[i]}`);
  });
  return sql.join(chunks, sql.raw(""));
}

/**
 * Vercel Cron (daily) — recompute the SEO core set into `seo_index_books`.
 * Writes only the rows that changed, and refuses a >30% shrink (see
 * recomputeCoreSet). Manual runs / forced changes: scripts/seo-index-recompute.ts.
 */
export async function GET(request: Request) {
  // Unlike keep-warm this route writes, so the secret is mandatory in prod.
  if (process.env.NODE_ENV === "production") {
    const secret = process.env.CRON_SECRET;
    if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const handle = db as unknown as {
    all: (q: SQL) => Promise<Row[]> | Row[];
    run: (q: SQL) => Promise<unknown> | unknown;
  };

  try {
    const report = await recomputeCoreSet(async (text, args = []) => {
      const q = bind(text, args);
      if (/^\s*select/i.test(text)) return await handle.all(q);
      await handle.run(q);
      return [];
    });
    console.log("[seo-index]", JSON.stringify(report));
    return NextResponse.json(report, { status: report.aborted ? 409 : 200 });
  } catch (err) {
    console.error("[seo-index] failed", err);
    return NextResponse.json({ error: "recompute failed" }, { status: 500 });
  }
}
