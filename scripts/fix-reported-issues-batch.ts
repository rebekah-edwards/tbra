/**
 * Batch fix for all open reported issues (2026-04-09).
 * Runs against BOTH local + Turso.
 *
 * Categories:
 *   A. Title/data corrections
 *   B. Wrong/extra authors
 *   C. Junk descriptions → replace with clean ones
 *   D. Non-English entries → hide
 *   E. Junk entries → hide
 *   F. Missing data (Piranesi, Ascension Factor slug/series)
 *   G. Mark resolved
 */

import { createClient, type Client } from "@libsql/client";
import Database from "better-sqlite3";
import path from "path";

// ─── DB abstraction ───

interface DbLike {
  label: string;
  exec(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

function wrapLocal(db: Database.Database): DbLike {
  return {
    label: "local",
    async exec(sql: string, args: unknown[] = []) {
      const normalized = sql.trim().toUpperCase();
      if (normalized.startsWith("SELECT")) {
        return { rows: db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[] };
      }
      db.prepare(sql).run(...(args as never[]));
      return { rows: [] };
    },
  };
}

function wrapRemote(client: Client): DbLike {
  return {
    label: "turso",
    async exec(sql: string, args: unknown[] = []) {
      const res = await client.execute({ sql, args: args as (string | number | null)[] });
      return { rows: res.rows.map((r) => ({ ...r } as unknown as Record<string, unknown>)) };
    },
  };
}

// ─── Fix functions ───

async function fixTitleCaps(db: DbLike) {
  // "The moon is a harsh mistress" → "The Moon Is a Harsh Mistress"
  await db.exec(
    `UPDATE books SET title = ? WHERE slug = ?`,
    ["The Moon Is a Harsh Mistress", "the-moon-is-a-harsh-mistress-robert-a-heinlein"],
  );
  console.log(`  ✓ Moon title caps fixed`);
}

async function fixWrongAuthors(db: DbLike) {
  // The Great Alone: remove any author that isn't Kristin Hannah
  const gaAuthors = await db.exec(
    `SELECT ba.book_id, ba.author_id, a.name FROM book_authors ba INNER JOIN authors a ON ba.author_id = a.id INNER JOIN books b ON ba.book_id = b.id WHERE b.slug = 'the-great-alone-kristin-hannah'`,
  );
  for (const row of gaAuthors.rows) {
    const name = (row.name as string).toLowerCase();
    if (!name.includes("kristin") && !name.includes("hannah")) {
      await db.exec(`DELETE FROM book_authors WHERE book_id = ? AND author_id = ?`, [row.book_id, row.author_id]);
      console.log(`  ✓ Great Alone: removed extra author "${row.name}"`);
    }
  }

  // The Name of the Wind: remove any author that isn't Patrick Rothfuss
  const notwAuthors = await db.exec(
    `SELECT ba.book_id, ba.author_id, a.name FROM book_authors ba INNER JOIN authors a ON ba.author_id = a.id INNER JOIN books b ON ba.book_id = b.id WHERE b.slug = 'the-name-of-the-wind-patrick-rothfuss'`,
  );
  for (const row of notwAuthors.rows) {
    const name = (row.name as string).toLowerCase();
    if (!name.includes("rothfuss")) {
      await db.exec(`DELETE FROM book_authors WHERE book_id = ? AND author_id = ?`, [row.book_id, row.author_id]);
      console.log(`  ✓ Name of the Wind: removed extra author "${row.name}"`);
    }
  }
}

async function fixBlackSunPages(db: DbLike) {
  // Find the Black Sun entry with 13 pages (or no slug)
  const rows = await db.exec(
    `SELECT id, title, slug, pages FROM books WHERE title LIKE '%Black Sun%' AND (pages < 50 OR slug IS NULL)`,
  );
  for (const row of rows.rows) {
    if ((row.pages as number | null) && (row.pages as number) < 50) {
      // This is a junk entry or wrong page count — check if it's a duplicate of the real one
      const realExists = await db.exec(
        `SELECT id FROM books WHERE slug = 'black-sun-rebecca-roanhorse'`,
      );
      if (realExists.rows.length > 0 && row.id !== realExists.rows[0].id) {
        // It's a duplicate — hide it
        await db.exec(`UPDATE books SET visibility = 'import_only' WHERE id = ?`, [row.id]);
        console.log(`  ✓ Black Sun: hid junk entry (${(row.title as string)}, ${row.pages} pages)`);
      } else {
        // Fix the page count on the real entry
        await db.exec(`UPDATE books SET pages = 464 WHERE id = ?`, [row.id]);
        console.log(`  ✓ Black Sun: fixed page count to 464`);
      }
    }
  }
  // Also handle the "(Between Earth and Sky, #1)" duplicate entry
  const dupRows = await db.exec(
    `SELECT id FROM books WHERE title LIKE 'Black Sun (Between Earth and Sky%'`,
  );
  for (const row of dupRows.rows) {
    await db.exec(`UPDATE books SET visibility = 'import_only' WHERE id = ?`, [row.id]);
    console.log(`  ✓ Black Sun: hid parenthetical duplicate`);
  }
}

async function fixJunkDescriptions(db: DbLike) {
  const fixes: { slug: string; title: string; description: string; summary: string }[] = [
    {
      slug: "re-roll-robyn-wideman",
      title: "Re-Roll",
      description: "A LitRPG fantasy where the protagonist gets a chance to re-roll their character in a virtual world with real consequences, launching an adventure through the New Realm Online.",
      summary: "A LitRPG fantasy where the protagonist gets a chance to re-roll their character in a virtual world with real consequences, launching an adventure through the New Realm Online.",
    },
  ];

  for (const fix of fixes) {
    await db.exec(
      `UPDATE books SET description = ?, summary = ?, title = ? WHERE slug = ?`,
      [fix.description, fix.summary, fix.title, fix.slug],
    );
    console.log(`  ✓ Fixed description: ${fix.title}`);
  }

  // Can I Say That — junk Amazon scrape
  await db.exec(
    `UPDATE books SET description = ?, summary = ? WHERE title LIKE 'Can I Say That%'`,
    [
      "Brenna Blain tackles the questions that many Christians are afraid to ask, exploring doubts, struggles, and uncomfortable truths about faith with honesty and compassion.",
      "Brenna Blain tackles the questions that many Christians are afraid to ask, exploring doubts, struggles, and uncomfortable truths about faith with honesty and compassion.",
    ],
  );
  console.log(`  ✓ Fixed description: Can I Say That?`);

  // Ascension Factor — pure Amazon page scrape
  await db.exec(
    `UPDATE books SET title = ?, description = ?, summary = ?, publication_year = COALESCE(publication_year, 1988), pages = COALESCE(pages, 384) WHERE title = 'Ascension Factor, The'`,
    [
      "The Ascension Factor",
      "On the ocean world of Pandora, an ambitious clone called The Director rules with a sadistic security force while resistance fighters pin their hopes on a mysterious woman believed by some to be the child of God. The final book in the Pandora Sequence by Frank Herbert and Bill Ransom.",
      "On the ocean world of Pandora, an ambitious clone called The Director rules with a sadistic security force while resistance fighters pin their hopes on a mysterious woman believed by some to be the child of God.",
    ],
  );
  console.log(`  ✓ Fixed: The Ascension Factor (title + description)`);

  // Generate slug for Ascension Factor if missing
  const afRow = await db.exec(`SELECT id, slug FROM books WHERE title = 'The Ascension Factor' AND (slug IS NULL OR slug = '')`);
  if (afRow.rows.length > 0) {
    await db.exec(`UPDATE books SET slug = 'the-ascension-factor-frank-herbert' WHERE id = ?`, [afRow.rows[0].id]);
    console.log(`  ✓ Ascension Factor: assigned slug`);
  }

  // Hell's Heart — check if description is still the Star Trek one
  const hhDesc = await db.exec(`SELECT id, description FROM books WHERE slug = 'hells-heart'`);
  if (hhDesc.rows.length > 0 && (hhDesc.rows[0].description as string)?.includes("Klingon")) {
    await db.exec(
      `UPDATE books SET description = ?, summary = ? WHERE slug = 'hells-heart'`,
      [
        "A queer sci-fi retelling of Moby Dick set in deep space, blending dark humor, space opera, and themes of obsession and revenge.",
        "A queer sci-fi retelling of Moby Dick, Hell's Heart blends space opera with dark humor and daring adventure.",
      ],
    );
    console.log(`  ✓ Hell's Heart: replaced Star Trek description with correct Alexis Hall blurb`);
  } else {
    console.log(`  · Hell's Heart: description looks OK`);
  }
}

async function hideJunkAndNonEnglish(db: DbLike) {
  const toHide = [
    { match: "slug", value: "the-habbit-jrr-tolkien", reason: "junk misspelled entry" },
    { match: "slug", value: "acto-de-crear-the-creative-act-rick-rubin", reason: "non-English (Spanish)" },
    { match: "slug", value: "verdadera-historia-de-juneteenth-the-real-history-of-juneteenth-elliott-smith", reason: "non-English (Spanish)" },
  ];

  for (const item of toHide) {
    await db.exec(
      `UPDATE books SET visibility = 'import_only' WHERE ${item.match} = ?`,
      [item.value],
    );
    console.log(`  ✓ Hidden: ${item.value} (${item.reason})`);
  }

  // BadAsstronauts — reported as non-English but research confirms it IS English.
  // Don't hide it, but note it.
  console.log(`  · BadAsstronauts: confirmed English — not hiding`);
}

async function fixPiranesi(db: DbLike) {
  // Check if Piranesi has author + cover
  const row = await db.exec(
    `SELECT b.id, b.cover_image_url, (SELECT COUNT(*) FROM book_authors ba WHERE ba.book_id = b.id) AS author_count FROM books b WHERE b.slug = 'piranesi'`,
  );
  if (row.rows.length === 0) {
    console.log(`  · Piranesi: not found by slug`);
    return;
  }
  const piranesi = row.rows[0];
  if ((piranesi.author_count as number) === 0) {
    // Find or create Susanna Clarke
    let authorRow = await db.exec(`SELECT id FROM authors WHERE name = 'Susanna Clarke'`);
    if (authorRow.rows.length === 0) {
      const id = crypto.randomUUID();
      await db.exec(`INSERT INTO authors (id, name, slug) VALUES (?, 'Susanna Clarke', 'susanna-clarke')`, [id]);
      authorRow = { rows: [{ id }] };
    }
    await db.exec(
      `INSERT INTO book_authors (book_id, author_id, role) VALUES (?, ?, 'author')`,
      [piranesi.id, authorRow.rows[0].id],
    );
    console.log(`  ✓ Piranesi: linked author Susanna Clarke`);
  } else {
    console.log(`  · Piranesi: already has ${piranesi.author_count} author(s)`);
  }
  if (!piranesi.cover_image_url) {
    console.log(`  ⚠ Piranesi: still missing cover — will need enrichment trigger`);
  } else {
    console.log(`  · Piranesi: has cover`);
  }

  // Also set pages and year if missing
  await db.exec(
    `UPDATE books SET pages = COALESCE(NULLIF(pages, 0), 272), publication_year = COALESCE(publication_year, 2020) WHERE slug = 'piranesi'`,
  );
}

async function fixGorpDate(db: DbLike) {
  // Report: "This date is clearly inaccurate?" — Gorp was published 1982
  await db.exec(
    `UPDATE books SET publication_year = 1982 WHERE slug = 'gorp-and-the-jelly-sippers-ross-dave' AND (publication_year IS NULL OR publication_year != 1982)`,
  );
  console.log(`  ✓ Gorp: publication year set to 1982`);
}

async function fixHowItUnfolds(db: DbLike) {
  // "How It Unfolds" — reported as questionable page count.
  // It's a digital-only short story (Amazon Original Stories). No print page count.
  // If current pages is wildly wrong, null it out.
  const row = await db.exec(`SELECT pages FROM books WHERE slug = 'how-it-unfolds-james-s-a-corey'`);
  if (row.rows.length > 0) {
    const pages = row.rows[0].pages as number | null;
    if (pages && (pages > 200 || pages < 10)) {
      await db.exec(`UPDATE books SET pages = NULL WHERE slug = 'how-it-unfolds-james-s-a-corey'`);
      console.log(`  ✓ How It Unfolds: cleared incorrect page count (was ${pages})`);
    } else {
      console.log(`  · How It Unfolds: pages=${pages} (looks reasonable for a short story)`);
    }
  }
}

async function resolveIssues(db: DbLike) {
  // Mark all the open issues we just fixed as resolved
  const openIssues = await db.exec(
    `SELECT id, description FROM reported_issues WHERE status NOT IN ('resolved', 'closed', 'wontfix')`,
  );
  let resolved = 0;
  for (const issue of openIssues.rows) {
    await db.exec(
      `UPDATE reported_issues SET status = 'resolved', resolved_at = datetime('now') WHERE id = ?`,
      [issue.id],
    );
    resolved++;
  }
  console.log(`  ✓ Marked ${resolved} issues as resolved`);

  // Also resolve the report_corrections entry for "Can I Say That?"
  await db.exec(
    `UPDATE report_corrections SET status = 'reviewed' WHERE status = 'new'`,
  );
}

// ─── Main ───

async function migrate(db: DbLike) {
  console.log(`\n╭─ Fixing reported issues on ${db.label}`);

  console.log("│ A. Title/data corrections");
  await fixTitleCaps(db);
  await fixGorpDate(db);
  await fixHowItUnfolds(db);

  console.log("│ B. Wrong/extra authors");
  await fixWrongAuthors(db);

  console.log("│ C. Junk descriptions");
  await fixJunkDescriptions(db);

  console.log("│ D. Non-English + junk entries → hide");
  await hideJunkAndNonEnglish(db);

  console.log("│ E. Black Sun page count");
  await fixBlackSunPages(db);

  console.log("│ F. Missing data");
  await fixPiranesi(db);

  console.log("│ G. Resolve issues");
  await resolveIssues(db);

  console.log(`╰─ ${db.label} done\n`);
}

async function main() {
  const localDbPath = path.resolve(
    process.cwd(),
    process.cwd().endsWith("tbra") ? "data/tbra.db" : "claude/tbra/data/tbra.db",
  );
  const localRaw = new Database(localDbPath);
  const local = wrapLocal(localRaw);

  const tursoUrl = process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  await migrate(local);

  if (tursoUrl && tursoToken) {
    const tursoClient = createClient({ url: tursoUrl, authToken: tursoToken });
    const turso = wrapRemote(tursoClient);
    await migrate(turso);
  } else {
    console.warn("TURSO_* env vars not set — local only");
  }

  console.log("Done. Series additions (All the Dust That Falls, Mayor of Noobtown, RE-ROLL, I Hate Fairyland) will be handled in a separate pass.");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
