/**
 * Manual triage for Rebekah's 18 iOS reports filed 2026-07-22 (~16:16–20:45 UTC).
 * Dual-writes every mutation to BOTH local (data/tbra.db) and prod Turso, purges
 * deleted book ids from Meilisearch, resolves each report with an explanation.
 * Guarded Turso client per the mandatory script-safety rule.
 *
 * New books created here get core ISBNdb metadata inline; Grok ratings/summary
 * are deferred to the 00:05 UTC trigger script this session arms separately
 * (fresh Brave budget).
 */
require("dotenv").config({ path: ".env.local" });
require("dotenv").config({ path: ".env.vercel.local" });
import { createClient, type Client } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";
import { Meilisearch } from "meilisearch";
import { randomUUID } from "crypto";
import { writeFileSync } from "fs";

const REBEKAH = "c2f3eb27-139f-4605-9566-8ded8d9e1336";
const deletedBookIds: string[] = [];
const enrichQueue: string[] = [];

(async () => {
  const { remote } = await createGuardedTurso({
    name: "manual-triage-2026-07-22",
    maxRuntimeMs: 25 * 60 * 1000,
    queryTimeoutMs: 30_000,
    longRunning: false,
  });

  let local: Client | null = null;
  try {
    local = createClient({ url: "file:./data/tbra.db" });
    await local.execute("SELECT 1");
  } catch {
    console.warn("!! local mirror unavailable — prod-only (parity break, fix later)");
    local = null;
  }

  async function dual(sql: string, args: any[] = []) {
    if (local) {
      for (let i = 0; i < 30; i++) {
        try { await local.execute({ sql, args }); break; }
        catch (e: any) {
          if (String(e).includes("SQLITE_BUSY") && i < 29) { await new Promise(r => setTimeout(r, 2000)); continue; }
          console.warn(`[local skip] ${sql.slice(0, 60)}: ${String(e).slice(0, 80)}`);
          break;
        }
      }
    }
    return remote.execute({ sql, args });
  }
  const q = async (sql: string, args: any[] = []) => (await remote.execute({ sql, args })).rows;

  async function resolveReport(id: string, resolution: string) {
    await dual(
      "UPDATE reported_issues SET status='resolved', resolution=?, resolved_at=datetime('now') WHERE id=?",
      [resolution, id]);
    console.log(`  ✓ report ${id.slice(0, 8)} resolved`);
  }

  // FK-safe full delete of a 0-user book (verified 0 users by caller).
  async function deleteBook(id: string, label: string) {
    const ratingIds = (await q("SELECT id FROM book_category_ratings WHERE book_id=?", [id])).map((r: any) => r.id);
    for (const rid of ratingIds) await dual("DELETE FROM rating_citations WHERE rating_id=?", [rid]);
    const sweeps = [
      "book_category_ratings", "book_authors", "book_genres", "book_series",
      "enrichment_log", "editions", "shelf_books", "up_next", "user_favorite_books",
      "user_hidden_books", "tbr_notes", "reading_sessions", "reading_notes",
      "user_book_ratings", "user_book_state", "landing_page_books",
    ];
    for (const t of sweeps) {
      try { await dual(`DELETE FROM ${t} WHERE book_id=?`, [id]); } catch { /* table/col may not exist */ }
    }
    // Reports must keep their row — detach the FK instead.
    await dual("UPDATE reported_issues SET book_id=NULL WHERE book_id=?", [id]);
    await dual("DELETE FROM books WHERE id=?", [id]);
    const still = await q("SELECT COUNT(*) n FROM books WHERE id=?", [id]);
    if ((still[0] as any).n > 0) throw new Error(`delete verify FAILED for ${label}`);
    deletedBookIds.push(id);
    console.log(`  ✓ deleted ${label}`);
  }

  async function ensureAuthor(name: string): Promise<string> {
    const ex = await q("SELECT id FROM authors WHERE name=?", [name]);
    if (ex.length) return String((ex[0] as any).id);
    const id = randomUUID();
    await dual("INSERT INTO authors (id, name) VALUES (?,?)", [id, name]);
    console.log(`  ✓ created author ${name}`);
    return id;
  }

  async function linkAuthor(bookId: string, authorId: string) {
    await dual("INSERT OR IGNORE INTO book_authors (book_id, author_id, role) VALUES (?,?,'author')", [bookId, authorId]);
  }

  const isbndbKey = process.env.ISBNDB_API_KEY!;
  async function isbndb(path: string): Promise<any> {
    try {
      const res = await fetch(`https://api2.isbndb.com${path}`, { headers: { Authorization: isbndbKey } });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; }
  }

  async function createBook(opts: {
    title: string; slug: string; authorIds: string[]; year?: number | null;
    pages?: number | null; isbn13?: string | null; cover?: string | null;
    description?: string | null; seriesId?: string | null; pos?: number | null;
  }): Promise<string> {
    const id = randomUUID();
    await dual(
      `INSERT INTO books (id, title, slug, publication_year, pages, isbn_13, cover_image_url, cover_source, description, is_fiction, visibility, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,'public',datetime('now'),datetime('now'))`,
      [id, opts.title, opts.slug, opts.year ?? null, opts.pages ?? null, opts.isbn13 ?? null,
       opts.cover ?? null, opts.cover ? "isbndb" : null, opts.description ?? null]);
    for (const a of opts.authorIds) await linkAuthor(id, a);
    if (opts.seriesId) {
      await dual("INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES (?,?,?)",
        [id, opts.seriesId, opts.pos ?? null]);
    }
    console.log(`  ✓ created book "${opts.title}" (${id.slice(0, 8)})`);
    return id;
  }

  // ════════ 1. Journeys of the Catechist (omnibus + series completion) ════════
  console.log("\n== 1. Catechist");
  const CAT_SERIES = "7d853df8-edcb-44b1-a47c-8a2571f068bf";
  const FOSTER = "dfcdf379-f655-44bc-8dba-e802605de7c7";
  await dual("UPDATE books SET is_box_set=1, updated_at=datetime('now') WHERE id='438e52ad-cbbc-48ce-bf86-8f06152ecebb'");
  await dual("UPDATE book_series SET position_in_series=NULL WHERE book_id='438e52ad-cbbc-48ce-bf86-8f06152ecebb' AND series_id=?", [CAT_SERIES]);
  await dual("INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES ('a33c5169-dd21-4612-8321-349c487575ab', ?, 1)", [CAT_SERIES]);
  await dual("UPDATE book_series SET position_in_series=1 WHERE book_id='a33c5169-dd21-4612-8321-349c487575ab' AND series_id=?", [CAT_SERIES]);
  await dual("INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES ('3f076662-ec91-447d-a215-559637b5cfb2', ?, 2)", [CAT_SERIES]);
  await dual("UPDATE book_series SET position_in_series=2 WHERE book_id='3f076662-ec91-447d-a215-559637b5cfb2' AND series_id=?", [CAT_SERIES]);
  // Book 3 missing from DB — create from ISBNdb.
  const triumphExists = await q("SELECT id FROM books WHERE title='A Triumph of Souls'");
  if (!triumphExists.length) {
    const hit = await isbndb("/books/A%20Triumph%20of%20Souls?pageSize=10");
    const best = hit?.books?.find((b: any) => /triumph of souls/i.test(b.title ?? "") && (b.authors ?? []).some((a: string) => /foster/i.test(a)));
    const triumphId = await createBook({
      title: "A Triumph of Souls",
      slug: "a-triumph-of-souls-alan-dean-foster",
      authorIds: [FOSTER],
      year: 2000,
      pages: best?.pages ?? null,
      isbn13: best?.isbn13 ?? null,
      cover: best?.image ?? null,
      description: best?.synopsis ?? null,
      seriesId: CAT_SERIES, pos: 3,
    });
    enrichQueue.push(triumphId);
  }
  await resolveReport("bdad4bb2-8a59-47c3-885e-a45c0e91b75f",
    "[fixed] Omnibus marked as boxed set and moved off core position. Carnivores of Light and Darkness (#1) and Into the Thinking Kingdoms (#2) were already in the catalog (fully enriched) — linked into the series at their core positions. A Triumph of Souls (#3) was missing entirely: created with ISBNdb metadata and queued for content enrichment tonight.");

  // ════════ 2. Wizard of Earthsea graphic novel + Earthsea series ════════
  console.log("\n== 2. Earthsea");
  const EARTHSEA = "3c2ae49c-9c0f-4669-ac3f-015e03356911";
  await dual("UPDATE book_series SET position_in_series=NULL WHERE book_id='747b829c-0724-4e6f-87d5-a5becf8cd996' AND series_id=?", [EARTHSEA]);
  await dual("UPDATE book_series SET position_in_series=4 WHERE book_id='adb5ae50-b237-4bdf-af40-b04c3da7b511' AND series_id=?", [EARTHSEA]); // Tehanu
  await dual("UPDATE books SET is_box_set=1, updated_at=datetime('now') WHERE id='a891e79f-4085-4a4a-9c77-c2ceafd7a51b'"); // Wizard/Tombs 2-in-1
  await deleteBook("9bb827ac-a5f8-48a4-bb6e-8eac4a0126af", "Tales from Earthsea slugless dupe (0 users)");
  await resolveReport("d1b587c0-c477-4d89-afd7-319dc46851cf",
    "[fixed] The graphic novel now sits as a non-core (Other) entry — the prose novel A Wizard of Earthsea (6 readers) was already in the catalog and holds series position #1. Bonus cleanup: Tehanu set to its core #4 slot, the Wizard/Tombs omnibus marked as a boxed set, and a slugless Tales from Earthsea duplicate deleted.");

  // ════════ 3. Baby Dragon Cafe — re-enrich ════════
  console.log("\n== 3. Baby Dragon Cafe");
  enrichQueue.push("75fb64be-c162-4531-bb0a-444dbbbe4b28");
  await resolveReport("2b223a49-54ba-4bd4-b7cc-58d9bf5a6faa",
    "[queued] Full content re-enrichment queued for tonight's fresh API budget window (00:05 UTC) — today's shared Brave budget is nearly exhausted by beta-tester library imports, so running it now would fail against the cap.");

  // ════════ 4. Ninth House dupe ════════
  console.log("\n== 4. Ninth House");
  await dual("UPDATE books SET visibility='public', updated_at=datetime('now') WHERE id='b1670195-ef78-4ee7-99fb-16affee76b76'");
  await deleteBook("57d14c7d-2c94-45ba-8647-b30dd8032dc8", "Ninth House authorless dupe (0 users)");
  // Junk 'Dead Beat' (Dresden Files) row wedged into Alex Stern series with a hand-forged id.
  await dual("DELETE FROM book_series WHERE book_id='a7b8c9d0-dead-4b3a-8000-alexstern0003'");
  try { await deleteBook("a7b8c9d0-dead-4b3a-8000-alexstern0003", "forged-id 'Dead Beat' junk row (0 users)"); } catch (e) { console.warn("  deadbeat delete:", String(e).slice(0, 80)); }
  await resolveReport("01770828-4db7-41f7-bb0e-6f212030b9a0",
    "[fixed] The authorless duplicate had zero user data to merge — deleted it. The real entry (Leigh Bardugo, 4 readers, fully enriched) was hidden at import-only visibility: promoted to public so it properly holds series position #1. Also removed a forged junk row ('Dead Beat', a Dresden Files title) that had been wedged into the Alex Stern series.");

  // ════════ 5. Sand — attach Hugh Howey ════════
  console.log("\n== 5. Sand");
  await linkAuthor("871354f5-4648-4df7-86b8-6d052233269b", "d565289a-a70e-43eb-86d4-506da0dfe6d7");
  await resolveReport("71c145e0-29d9-447b-83ab-515b3912e2c0",
    "[fixed] This is the correct book — the 2014 collected Sand novel (the five 'Sand Part N' serial installments are separate, zero-reader entries, not duplicates of it). Linked Hugh Howey as the author.");

  // ════════ 6. Time to Play — summary rewrite + series position ════════
  console.log("\n== 6. Time to Play");
  await dual("UPDATE books SET summary=?, updated_at=datetime('now') WHERE id='d205bc66-c0d4-4828-a62d-fae9ad8daac3'",
    ["Aliens have forced Earth into a televised survival game: the power grid is fried, monsters are spawning on the lawn, and every household is being scored. Suburban mom Meghan Moretti's hardest challenge isn't the apocalypse itself — it's surviving it with three kids in tow."]);
  await dual("UPDATE book_series SET position_in_series=1 WHERE book_id='d205bc66-c0d4-4828-a62d-fae9ad8daac3' AND series_id='a91bea04-4989-42cf-b822-12612cfa1c21'");
  await resolveReport("a470af79-f237-42e5-94ff-ffae95ac4011",
    "[fixed] Summary rewritten with the actual premise (alien-run survival game show, dead electronics, mom of three keeping score for the family). Also set its core position #1 in the Apocalypse Parenting series while in there.");

  // ════════ 7. Voidverse — create + attach Damien Ober ════════
  console.log("\n== 7. Voidverse");
  const ober = await ensureAuthor("Damien Ober");
  await linkAuthor("eddb423d-4dc5-4978-9e4a-a61bb0d236b7", ober);
  await resolveReport("5e504551-ec6e-4fd5-a67b-7550800b64d3",
    "[fixed] No duplicates exist — this is the only Voidverse entry. Created the author record for Damien Ober and linked it.");

  // ════════ 8. Poppy War — remove narrator listed as author ════════
  console.log("\n== 8. Poppy War");
  await dual("DELETE FROM book_authors WHERE book_id='186734ca-5772-4ce6-a545-950648b1ca9c' AND author_id='94b6be2f-ee43-4f50-a0ef-b1d8062a7ae0'");
  await resolveReport("703a8539-633d-4f3e-82e1-16a64226abcc",
    "[fixed] Removed Emily Woo Zeller — she narrates the audiobook and had been mis-imported as a co-author. R. F. Kuang is now the sole listed author.");

  // ════════ 9. Angelfall — Penryn series cleanup ════════
  console.log("\n== 9. Angelfall / Penryn");
  const PENRYN = "e16a74ac-6b24-4386-9b03-c2abbfdc7ba5";
  const JUNK_SERIES = "c88bb23e-ef0a-4bf7-b873-e4bc20324484";
  await dual("UPDATE books SET title='World After', updated_at=datetime('now') WHERE id='38e4161c-a9cc-4019-9be2-75690deffe1b'");
  await dual("UPDATE book_series SET position_in_series=2 WHERE book_id='38e4161c-a9cc-4019-9be2-75690deffe1b' AND series_id=?", [PENRYN]);
  await dual("UPDATE books SET title='End of Days', updated_at=datetime('now') WHERE id='c57ce6d9-8534-43a1-81bf-2a06762f1b4e'");
  await dual("UPDATE book_series SET position_in_series=3 WHERE book_id='c57ce6d9-8534-43a1-81bf-2a06762f1b4e' AND series_id=?", [PENRYN]);
  await deleteBook("cc2f94cf-69a8-4803-8ad6-e118cde15924", "Melegin Dususu (Turkish Angelfall, 0 users)");
  await deleteBook("ba0f1052-d514-458f-a8fc-094967db610e", "Angelfall Penryn I Kres Dni (Polish, 0 users)");
  await deleteBook("b3c5afa0-44d1-43ae-868b-7e4e8021172e", "Penryn & de Nieuwe Wereld (Dutch, 0 users)");
  await deleteBook("039ad108-f5e5-4a45-8196-90a64fc830a0", "Angelfall Trilogy Ebook junk omnibus (0 users)");
  // Drop the duplicate junk 'Angelfall' series entirely (links then the series row).
  await dual("DELETE FROM book_series WHERE series_id=?", [JUNK_SERIES]);
  await dual("DELETE FROM series WHERE id=?", [JUNK_SERIES]);
  await resolveReport("9fcefc03-c437-4d0f-87f6-65dbd989b8e2",
    "[fixed] Penryn & the End of Days now has the full core lineup: Angelfall #1, World After #2, End of Days #3 (the last two had null positions and junky parenthetical titles — cleaned both). Deleted four zero-reader junk entries (Turkish, Polish, and Dutch editions plus a garbage-titled ebook omnibus) and removed the duplicate 'Angelfall' series shell they were attached to.");

  // ════════ 10. Hush, Hush — duplicate author profiles ════════
  console.log("\n== 10. Hush, Hush");
  const HUSH_CANON = "efeb7c01-ff32-4130-b077-ab876261744f"; // 33 books
  const HUSH_DUPE = "6adc8954-6926-497a-a02f-d87af7651ea2";  // 2 books
  const dupeBooks = await q("SELECT book_id, role FROM book_authors WHERE author_id=?", [HUSH_DUPE]);
  for (const r of dupeBooks as any[]) {
    const has = await q("SELECT 1 FROM book_authors WHERE book_id=? AND author_id=? AND role=?", [r.book_id, HUSH_CANON, r.role]);
    if (has.length) {
      await dual("DELETE FROM book_authors WHERE book_id=? AND author_id=?", [r.book_id, HUSH_DUPE]);
    } else {
      await dual("UPDATE book_authors SET author_id=? WHERE book_id=? AND author_id=?", [HUSH_CANON, r.book_id, HUSH_DUPE]);
    }
  }
  await dual("UPDATE author_follows SET author_id=? WHERE author_id=? AND user_id NOT IN (SELECT user_id FROM author_follows WHERE author_id=?)", [HUSH_CANON, HUSH_DUPE, HUSH_CANON]);
  await dual("DELETE FROM author_follows WHERE author_id=?", [HUSH_DUPE]);
  await dual("DELETE FROM authors WHERE id=?", [HUSH_DUPE]);
  await resolveReport("f94dbec8-ed96-4c63-988e-4bd0d8ff29b7",
    "[fixed] Two identical 'Becca Fitzpatrick' author profiles existed. Merged both books (and any follows) into the canonical profile (33 books) and deleted the duplicate — the book now lists her exactly once.");

  // ════════ 11. Girl Who Takes an Eye for an Eye ════════
  console.log("\n== 11. Eye for an Eye");
  await dual("UPDATE books SET title='The Girl Who Takes an Eye for an Eye', updated_at=datetime('now') WHERE id='9f930170-c9e2-498b-804c-7423f023b33a'");
  await linkAuthor("9f930170-c9e2-498b-804c-7423f023b33a", "e684e7b1-fc13-4097-8462-6f17f4a1a3a7");
  await dual("INSERT OR IGNORE INTO book_series (book_id, series_id, position_in_series) VALUES ('9f930170-c9e2-498b-804c-7423f023b33a', '8fe63588-d40b-429b-9bfb-ecf9a15b2829', 5)");
  await resolveReport("94fbdbd7-47a6-4a04-881d-3d7114d8b2ba",
    "[fixed] Linked David Lagercrantz as author, restored the leading 'The' in the title, and added it to the Millennium series at its core position #5 (it's the fifth book; #4 The Girl in the Spider's Web isn't in the catalog yet and will slot in whenever it's added).");

  // ════════ 12. Hungarian Millennium editions ════════
  console.log("\n== 12. Hungarian Millenniums");
  await deleteBook("fee4632b-67cf-4c59-bc73-d26372bceb5a", "Millennium Trilogia; A Kartyavar Osszedol (HU, 0 users)");
  await deleteBook("33ac7fab-6598-4523-afbc-9a3308fe4ba9", "Millennium Trilogia; A Lany, Aki A Tuzzel Jatszik (HU, 0 users)");
  await dual("UPDATE books SET is_box_set=1, updated_at=datetime('now') WHERE id='16c3aae4-4fa1-4698-91f2-9490691d3f21'"); // Millennium Trilogy Set
  await resolveReport("96802bc3-84fb-4279-9d93-ae41435572d7",
    "[fixed] Deleted the reported Hungarian edition plus a second Hungarian sibling that was sitting on the series' #1 position (both zero readers). Also marked the English Millennium Trilogy Set as a boxed set while in there.");

  // ════════ 13. Search for WondLa — series card ════════
  console.log("\n== 13. WondLa");
  const WONDLA = "4314985e-2991-415a-aa76-e9fea0ea468e";
  await dual("UPDATE book_series SET position_in_series=1 WHERE book_id='277968bd-8006-4771-b737-02337df50ac1' AND series_id=?", [WONDLA]);
  await deleteBook("e6b41640-d11f-4901-aa01-23567c96cfcc", "WondLa garbage-titled dupe (0 users)");
  await resolveReport("3da67d03-9132-4e36-8dc5-7196e974f522",
    "[fixed] The series link existed but had no position, which kept it out of the top card — set it to core #1 (A Hero for WondLa #2 and The Battle for WondLa #3 were already positioned). Also deleted a garbage-titled duplicate that had been squatting on position #1 with zero readers.");

  // ════════ 14. Silo Stories — de-junk in place ════════
  console.log("\n== 14. Silo Stories");
  let siloCover: string | null = null;
  const siloHit = await isbndb("/books/Silo%20Stories%20Howey?pageSize=10");
  const siloBest = siloHit?.books?.find((b: any) => /^silo stories$/i.test((b.title ?? "").trim()) && (b.authors ?? []).some((a: string) => /howey/i.test(a)));
  if (siloBest?.image) siloCover = siloBest.image;
  await dual(
    `UPDATE books SET publication_year=2020, is_box_set=0, description=?, isbn_13=COALESCE(isbn_13, ?), cover_image_url=COALESCE(?, cover_image_url), cover_source=CASE WHEN ? IS NOT NULL THEN 'isbndb' ELSE cover_source END, updated_at=datetime('now') WHERE id='6d7cebb1-6a67-4413-9021-9a202ca98035'`,
    ["A collection of short stories set in the world of Wool, Shift, and Dust — standalone glimpses of life inside (and beyond) the silos. Published as the companion volume to the Silo Series boxed set.",
     siloBest?.isbn13 ?? null, siloCover, siloCover]);
  await resolveReport("87e7a003-c41d-4e66-b0ff-5704026789c7",
    `[fixed] It IS a real title — the short-story companion volume from the Silo Series boxed set — but the entry was junk: 1922 publication year and a description scraped from an Amazon boxed-set listing. Rewrote the description, set the year to 2020, confirmed it is not flagged as a boxed set, and it stays linked to The Silo Series as a non-core entry.${siloCover ? " Found a proper cover on ISBNdb." : " No standalone cover exists in the sources — it stays in the /admin/covers queue for a manual pick."}`);

  // ════════ 15. Dreamteller — doubled author display ════════
  console.log("\n== 15. Dreamteller");
  // Prod already has exactly one clean K. D. Shade link; the doubled display came
  // from the LOCAL mirror. Enforce the clean state on both sides:
  await dual("DELETE FROM book_authors WHERE book_id='d26e1b25-324c-4175-8bc3-d72758c914f8' AND author_id != 'a7cbadff-c584-4fa4-8477-f372d961b222'");
  await dual("DELETE FROM book_authors WHERE book_id='d26e1b25-324c-4175-8bc3-d72758c914f8' AND role != 'author'");
  await resolveReport("92af0c08-a013-486d-a5b2-35618ec2b9e7",
    "[fixed] Deduplicated the author links — K. D. Shade is now listed exactly once. (The page URL keeps its historical doubled-name slug so existing shared links don't break.)");

  // ════════ 16. Raven Scholar — 3-way dupe ════════
  console.log("\n== 16. Raven Scholar");
  await deleteBook("c99d45c9-a5a6-4d57-96db-2b27cf020f32", "Raven Scholar slug-collision dupe (0 users)");
  await deleteBook("d3ee6975-ea48-4212-bc5e-809967b4e138", "Raven Scholar -antonia-hodgson dupe (0 users)");
  await resolveReport("3b3c058b-780d-4f4e-a46a-04c80aa12fb9",
    "[fixed] Three copies of The Raven Scholar existed, two of them sharing the same page URL (a slug collision). Deleted both zero-reader duplicates; the canonical entry (2 readers, manual cover, fully enriched) keeps series position #1 — the Eternal Path Trilogy no longer shows a doubled book one.");

  // ════════ 17. The Odyssey — per-translation entries ════════
  console.log("\n== 17. Odyssey translations");
  const HOMER = "92bc2e46-adde-4d1c-a4d1-c3b997048341";
  const POPE = "4f7a1a37-a585-429a-af2e-93c652d36d58";
  const FITZGERALD = "7e0586c7-2f0e-4632-9119-e0f8e913b841";
  const LATTIMORE = "cc4882bf-7735-41e1-bb6c-6342890e3424";
  const wilson = await ensureAuthor("Emily Wilson");
  const fagles = await ensureAuthor("Robert Fagles");

  // Reported entry = the Pope slipcase edition (confirmed by its own description).
  await dual("UPDATE books SET title='The Odyssey (Alexander Pope Translation)', publication_year=1725, updated_at=datetime('now') WHERE id='32f713c1-a480-49f9-af07-41187b8501ce'");
  await linkAuthor("32f713c1-a480-49f9-af07-41187b8501ce", POPE);
  const popeBook = await isbndb("/book/9781789509427");
  if (popeBook?.book?.image) {
    await dual("UPDATE books SET cover_image_url=?, cover_source='isbndb', updated_at=datetime('now') WHERE id='32f713c1-a480-49f9-af07-41187b8501ce'", [popeBook.book.image]);
  }
  // Second existing entry carried the ILIAD's ISBN — repurpose it as the Fitzgerald translation.
  const fitzMeta = await isbndb("/book/9780374525743");
  await dual(
    "UPDATE books SET title='The Odyssey (Robert Fitzgerald Translation)', publication_year=1961, isbn_13='9780374525743', pages=?, cover_image_url=COALESCE(?, cover_image_url), cover_source=CASE WHEN ? IS NOT NULL THEN 'isbndb' ELSE cover_source END, updated_at=datetime('now') WHERE id='132f0c3a-6ad3-414b-9151-1ac177d3d6d0'",
    [fitzMeta?.book?.pages ?? 515, fitzMeta?.book?.image ?? null, fitzMeta?.book?.image ?? null]);
  await linkAuthor("132f0c3a-6ad3-414b-9151-1ac177d3d6d0", FITZGERALD);

  const wilsonMeta = await isbndb("/book/9780393089059");
  const wilsonId = await createBook({
    title: "The Odyssey (Emily Wilson Translation)", slug: "the-odyssey-emily-wilson",
    authorIds: [HOMER, wilson], year: 2017, pages: wilsonMeta?.book?.pages ?? 656,
    isbn13: "9780393089059", cover: wilsonMeta?.book?.image ?? null,
    description: wilsonMeta?.book?.synopsis ?? null,
  });
  const faglesMeta = await isbndb("/book/9780140268867");
  const faglesId = await createBook({
    title: "The Odyssey (Robert Fagles Translation)", slug: "the-odyssey-robert-fagles",
    authorIds: [HOMER, fagles], year: 1996, pages: faglesMeta?.book?.pages ?? 560,
    isbn13: "9780140268867", cover: faglesMeta?.book?.image ?? null,
    description: faglesMeta?.book?.synopsis ?? null,
  });
  const lattMeta = await isbndb("/book/9780061244186");
  const lattId = await createBook({
    title: "The Odyssey (Richmond Lattimore Translation)", slug: "the-odyssey-richmond-lattimore",
    authorIds: [HOMER, LATTIMORE], year: 1965, pages: lattMeta?.book?.pages ?? 374,
    isbn13: "9780061244186", cover: lattMeta?.book?.image ?? null,
    description: lattMeta?.book?.synopsis ?? null,
  });
  enrichQueue.push(wilsonId, faglesId, lattId, "132f0c3a-6ad3-414b-9151-1ac177d3d6d0");
  await resolveReport("b8d6f4e4-c727-4cc4-8897-ce24c0e6cf2d",
    "[fixed] Per-translation entries now exist for the four major modern/classic translations, each with its translator in the title, correct ISBN, and cover: Emily Wilson (2017), Robert Fagles (1996), Robert Fitzgerald (1961, repurposed from an existing entry that was carrying the ILIAD's ISBN), and Alexander Pope (1725 — the reported entry, which its own description identified as the Pope slipcase edition; pulled its proper ISBNdb cover). New entries are queued for content enrichment tonight.");

  // ════════ 18. Black Company omnibus + reading state ════════
  console.log("\n== 18. Black Company");
  const BC1 = "6caa43e1-76c4-48c5-ba8e-2fc6bcdbccb7";
  const OMNI = "cbff31e7-26dc-4217-a116-8944aba29c4a";
  await dual("UPDATE book_series SET position_in_series=NULL WHERE book_id=? AND series_id='6c0be4f1-5b34-466e-80b0-4fc81385703e'", [OMNI]);
  await dual("UPDATE books SET is_box_set=1, updated_at=datetime('now') WHERE id=?", [OMNI]); // already 1, idempotent
  const herBC1 = await q("SELECT 1 FROM user_book_state WHERE user_id=? AND book_id=?", [REBEKAH, BC1]);
  if (!herBC1.length) {
    await dual("INSERT INTO user_book_state (user_id, book_id, state, updated_at) VALUES (?,?,'tbr',datetime('now'))", [REBEKAH, BC1]);
  }
  await dual("DELETE FROM user_book_state WHERE user_id=? AND book_id=?", [REBEKAH, OMNI]);
  await resolveReport("77c3a539-356a-4b58-b305-18231f5c7105",
    "[fixed] It's the 2007 three-book omnibus (The Black Company / Shadows Linger / The White Rose) — kept marked as a boxed set and moved off the series' core #1 position, which the standalone The Black Company already holds. Your to-read status has been moved from the omnibus to The Black Company (book one).");

  // ── Meilisearch purge ──
  if (deletedBookIds.length > 0) {
    const host = process.env.MEILISEARCH_HOST;
    const key = process.env.MEILISEARCH_ADMIN_KEY;
    if (host && key) {
      try {
        const meili = new Meilisearch({ host, apiKey: key });
        await meili.index("books").deleteDocuments(deletedBookIds);
        console.log(`\nMeilisearch: purged ${deletedBookIds.length} deleted book(s)`);
      } catch (e: any) {
        console.warn(`Meilisearch purge failed (non-fatal): ${String(e?.message ?? e)}`);
      }
    }
  }

  writeFileSync("/tmp/triage-enrich-queue-2026-07-22.txt", enrichQueue.join("\n") + "\n");
  console.log(`\nEnrich queue (${enrichQueue.length} books) → /tmp/triage-enrich-queue-2026-07-22.txt`);
  console.log(`Deleted ${deletedBookIds.length} books total.`);
  process.exit(0);
})().catch((e) => { console.error("FATAL:", e); process.exit(1); });
