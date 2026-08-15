/**
 * "Option A" for edition-variant groups that have NO undecorated canon —
 * every row in the group is decorated ("Y The Last Man - Deluxe Edition" ×2),
 * so there is nothing to merge INTO. The group is collapsed onto one survivor
 * and that survivor is RENAMED to the clean title.
 *
 * Renaming changes the public slug, and public book URLs are slugs, so every
 * rename records the old slug in `book_slug_history` — that is what keeps
 * existing links, bookmarks and indexed results alive (see resolveBook()).
 *
 * Three phases, run in order:
 *
 *   1. --plan          print the proposed survivor + clean title for review and
 *                      write a scan-shaped file for the merge tooling
 *   2. (merge)         npx tsx scripts/apply-edition-variant-merges.ts --scan=<planfile> --apply
 *                      npx tsx scripts/replay-dedup-both.ts --manifest=<emitted> --apply
 *   3. --apply-rename  rename the survivors, assign new slugs, record redirects
 *
 * The merge is delegated to the existing, verified tooling rather than
 * reimplemented — this script only decides WHICH row survives and what it is
 * called.
 */
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env.vercel.local" });

import Database from "better-sqlite3";
import fs from "fs";
import { createGuardedTurso } from "./lib/turso-guard";
import {
  editionMatchKey,
  isDecoratedTitle,
  normalizeAuthor,
  stripEditionSuffixRaw,
  extractEditionLabel,
} from "../src/lib/text/edition-title";
import { generateBookSlug } from "../src/lib/utils/slugify";

const PLAN = process.argv.includes("--plan");
const APPLY_RENAME = process.argv.includes("--apply-rename");
const APPLY = process.argv.includes("--apply");
const PLAN_FILE = "reports/no-canon-rename-plan.json";

/**
 * Escape hatch for clean titles the automatic stripper cannot produce.
 *
 * Empty as of 2026-08-15: this held "H Is for Homicide 1ST Edition" while bare
 * ordinals were unhandled, but EDITION_SUFFIX now strips a leading-`1st`
 * printing marker (audited — see the note there), so the stripper produces it
 * directly. Prefer fixing the regex when an audit shows the change is safe;
 * use this only when a title's cleanup would otherwise force a catalog-wide
 * matching change.
 */
const TITLE_OVERRIDES: Record<string, string> = {};

function cleanTitleFor(raw: string): string {
  return TITLE_OVERRIDES[raw] ?? stripEditionSuffixRaw(raw);
}

type Row = {
  id: string;
  title: string;
  slug: string | null;
  visibility: string | null;
  author_name: string | null;
  users: number;
  cover_image_url: string | null;
  isbn13: string | null;
  isbn10: string | null;
  pages: number | null;
  publisher: string | null;
  publication_year: number | null;
};

(async () => {
  const local = new Database("data/tbra.db");
  const { remote } = await createGuardedTurso({
    name: "rename-no-canon-editions",
    maxRuntimeMs: 30 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  if (PLAN) {
    const rows = local
      .prepare(
        `SELECT b.id, b.title, b.slug, b.visibility, b.cover_image_url, b.isbn_13 AS isbn13, b.isbn_10 AS isbn10,
                b.pages, b.publisher, b.publication_year,
                (SELECT a.name FROM authors a JOIN book_authors ba ON ba.author_id = a.id
                  WHERE ba.book_id = b.id ORDER BY a.name LIMIT 1) AS author_name,
                (SELECT COUNT(*) FROM user_book_state WHERE book_id = b.id) AS users
         FROM books b WHERE b.is_box_set = 0`,
      )
      .all() as Row[];

    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      if (!r.title || !r.author_name) continue;
      const key = `${editionMatchKey(r.title)}|||${normalizeAuthor(r.author_name)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(r);
    }

    const plan: any[] = [];
    for (const [, g] of groups) {
      if (g.length < 2) continue;
      const decorated = g.filter((r) => isDecoratedTitle(r.title));
      if (decorated.length === 0) continue;
      if (g.length !== decorated.length) continue; // has a canon — normal merge path

      // Survivor: public first, then most shelf activity, then richest metadata.
      // Same ordering the normal path uses to pick a canon, minus the
      // undecorated-title term (nothing here is undecorated).
      const survivor = [...g].sort(
        (a, b) =>
          (b.visibility === "public" ? 1 : 0) - (a.visibility === "public" ? 1 : 0) ||
          Number(b.users) - Number(a.users) ||
          (b.cover_image_url ? 1 : 0) - (a.cover_image_url ? 1 : 0) ||
          (b.isbn13 ? 1 : 0) - (a.isbn13 ? 1 : 0) ||
          (b.publication_year ?? 0) - (a.publication_year ?? 0),
      )[0];

      const losers = g.filter((r) => r.id !== survivor.id);
      const newTitle = cleanTitleFor(survivor.title);
      const newSlug = generateBookSlug(newTitle, survivor.author_name ?? "");

      plan.push({
        survivor_id: survivor.id,
        survivor_title: survivor.title,
        survivor_slug: survivor.slug,
        author: survivor.author_name,
        new_title: newTitle,
        new_slug: newSlug,
        // scan-shape so apply-edition-variant-merges.ts can consume it directly
        autoMergePairs: losers.map((l) => ({
          dupe_id: l.id,
          dupe_title: l.title,
          dupe_slug: l.slug,
          dupe_users: Number(l.users),
          canonical_id: survivor.id,
          canonical_title: survivor.title,
          canonical_slug: survivor.slug,
          edition: {
            label: extractEditionLabel(l.title),
            isbn13: l.isbn13,
            isbn10: l.isbn10,
            coverUrl: l.cover_image_url,
            pages: l.pages,
            publisher: l.publisher,
            year: l.publication_year,
          },
        })),
      });
    }

    console.log(`[no-canon] ${plan.length} groups\n`);
    for (const p of plan) {
      console.log(`"${p.survivor_title}"`);
      console.log(`   -> title: "${p.new_title}"`);
      console.log(`   -> slug:  ${p.survivor_slug ?? "(none)"}  ->  ${p.new_slug}`);
      console.log(`   merging in: ${p.autoMergePairs.map((x: any) => `"${x.dupe_title}"`).join(", ")}`);
      const withUsers = p.autoMergePairs.filter((x: any) => x.dupe_users > 0);
      if (withUsers.length) console.log(`   NOTE: loser carries user rows (${withUsers.length})`);
      console.log("");
    }

    fs.writeFileSync(
      PLAN_FILE,
      JSON.stringify(
        { autoMerge: plan.flatMap((p) => p.autoMergePairs), supervised: [], renames: plan },
        null,
        2,
      ),
    );
    console.log(`plan written: ${PLAN_FILE}`);
    process.exit(0);
  }

  if (APPLY_RENAME) {
    const plan = JSON.parse(fs.readFileSync(PLAN_FILE, "utf8"));
    let renamed = 0;
    let redirects = 0;

    for (const p of plan.renames) {
      // Only rename a survivor whose merge actually completed — otherwise the
      // group still has two rows and renaming one creates a title collision.
      const leftovers = p.autoMergePairs.filter((x: any) =>
        local.prepare("SELECT 1 FROM books WHERE id = ?").get(x.dupe_id),
      );
      if (leftovers.length) {
        console.log(`SKIP "${p.survivor_title}" — ${leftovers.length} loser row(s) still present; merge first`);
        continue;
      }

      // Resolve slug collisions against BOTH databases before claiming one.
      let slug = p.new_slug;
      let n = 2;
      for (;;) {
        const l = local.prepare("SELECT id FROM books WHERE slug = ?").get(slug) as any;
        const t = (
          await remote.execute({ sql: "SELECT id FROM books WHERE slug = ?", args: [slug] })
        ).rows[0] as any;
        const lFree = !l || l.id === p.survivor_id;
        const tFree = !t || t.id === p.survivor_id;
        if (lFree && tFree) break;
        slug = `${p.new_slug}-${n++}`;
      }

      console.log(`RENAME "${p.survivor_title}" -> "${p.new_title}"   slug ${p.survivor_slug ?? "(none)"} -> ${slug}`);

      if (APPLY) {
        const ts = new Date().toISOString();
        local
          .prepare("UPDATE books SET title = ?, slug = ?, updated_at = ? WHERE id = ?")
          .run(p.new_title, slug, ts, p.survivor_id);
        await remote.execute({
          sql: "UPDATE books SET title = ?, slug = ?, updated_at = ? WHERE id = ?",
          args: [p.new_title, slug, ts, p.survivor_id],
        });

        // The survivor's own old slug now points nowhere — redirect it.
        if (p.survivor_slug && p.survivor_slug !== "null" && p.survivor_slug !== slug) {
          for (const w of [
            () =>
              local
                .prepare("INSERT OR IGNORE INTO book_slug_history (old_slug, book_id, reason) VALUES (?,?,?)")
                .run(p.survivor_slug, p.survivor_id, "rename"),
            () =>
              remote.execute({
                sql: "INSERT OR IGNORE INTO book_slug_history (old_slug, book_id, reason) VALUES (?,?,?)",
                args: [p.survivor_slug, p.survivor_id, "rename"],
              }),
          ])
            await w();
          redirects++;
        }
      }
      renamed++;
    }

    console.log(`\n[no-canon] ${APPLY ? "renamed" : "would rename"}: ${renamed}, redirects: ${redirects}`);
    if (!APPLY) console.log("DRY RUN — add --apply");
    process.exit(0);
  }

  console.error("Pass --plan or --apply-rename [--apply]");
  process.exit(1);
})();
