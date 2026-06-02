/**
 * One-off: resolve the structural beta-report backlog (series cleanup, merges,
 * author fixes) on production Turso. Guarded. Creates missing books as flagged
 * stubs and writes their ids to /tmp/new-book-ids.txt for the enrichment pass.
 */
require("dotenv").config({ path: ".env.vercel.local" });
import { createGuardedTurso } from "./lib/turso-guard";
import * as fs from "fs";

const CASCADE = ["book_authors","book_genres","book_series","book_category_ratings","book_narrators","links","report_corrections","editions","user_owned_editions","enrichment_log","user_hidden_books","reading_notes","up_next","user_favorite_books","user_book_reviews","user_book_ratings","reading_sessions","user_book_state","tbr_notes","shelf_books"];

(async () => {
  const { remote } = await createGuardedTurso({ name: "fix-series-batch", maxRuntimeMs: 20*60*1000, queryTimeoutMs: 30000, longRunning: true });
  const q = (sql:string,args:any[]=[])=>remote.execute({sql,args});
  const one = async (sql:string,args:any[]=[])=> (await q(sql,args)).rows[0] as any;
  const uuid = () => (globalThis as any).crypto.randomUUID();
  const slugify = (s:string)=>s.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-zA-Z0-9\s]/g,"").replace(/\s+/g," ").trim().toLowerCase().replace(/\s/g,"-");
  const newIds: string[] = [];

  const bookIdBySlug = async (slug:string) => (await one("SELECT id FROM books WHERE slug=?",[slug]))?.id ?? null;
  const findOrCreateAuthor = async (name:string) => {
    const e = await one("SELECT id FROM authors WHERE name=?",[name]);
    if (e) return e.id;
    const id = uuid(); await q("INSERT INTO authors (id,name) VALUES (?,?)",[id,name]); return id;
  };
  const uniqueSlug = async (base:string) => {
    let s = base, i = 1;
    while (await one("SELECT 1 FROM books WHERE slug=?",[s])) { i++; s = `${base}-${i}`; }
    return s;
  };
  const setSeries = async (bookId:string, seriesId:string, pos:number) => {
    await q("DELETE FROM book_series WHERE book_id=? AND series_id=?",[bookId,seriesId]);
    await q("INSERT INTO book_series (book_id,series_id,position_in_series) VALUES (?,?,?)",[bookId,seriesId,pos]);
  };
  const createBook = async (title:string, authorId:string, seriesId:string, pos:number) => {
    const id = uuid(); const slug = await uniqueSlug(slugify(title));
    await q("INSERT INTO books (id,title,slug,is_fiction,visibility,needs_review,review_reason,created_at,updated_at) VALUES (?,?,?,1,'public',1,'auto-created from series fill — needs enrichment',datetime('now'),datetime('now'))",[id,title,slug]);
    await q("INSERT INTO book_authors (book_id,author_id) VALUES (?,?)",[id,authorId]);
    await setSeries(id, seriesId, pos);
    newIds.push(id);
    console.log(`  + created "${title}" [${slug}] pos ${pos}`);
    return id;
  };
  const deleteBookFull = async (bookId:string) => {
    await q("UPDATE reported_issues SET book_id=NULL WHERE book_id=?",[bookId]);
    for (const t of CASCADE) { try { await q(`DELETE FROM ${t} WHERE book_id=?`,[bookId]); } catch(e:any){ if(!/no such table/i.test(e.message)) throw e; } }
    await q("DELETE FROM books WHERE id=?",[bookId]);
  };
  const ensureSeries = async (name:string) => {
    const e = await one("SELECT id FROM series WHERE name=?",[name]);
    if (e) return e.id;
    const id = uuid(); await q("INSERT INTO series (id,name,slug) VALUES (?,?,?)",[id,name,slugify(name)]);
    console.log(`  + created series "${name}"`); return id;
  };
  const resolveByBook = async (slug:string, note:string) => {
    const bid = await bookIdBySlug(slug); if(!bid) return 0;
    return (await q("UPDATE reported_issues SET status='resolved',resolved_at=datetime('now'),resolution=? WHERE book_id=? AND status='new'",[note,bid])).rowsAffected;
  };
  const resolveBySeries = async (seriesId:string, note:string) =>
    (await q("UPDATE reported_issues SET status='resolved',resolved_at=datetime('now'),resolution=? WHERE series_id=? AND status='new'",[note,seriesId])).rowsAffected;

  // ── 1. Ground Zero — author is the narrator ──
  { const bid = await bookIdBySlug("ground-zero-vikas-adam");
    if (bid) {
      const ryan = await findOrCreateAuthor("Nicholas Ryan");
      await q("DELETE FROM book_authors WHERE book_id=?",[bid]);
      await q("INSERT INTO book_authors (book_id,author_id) VALUES (?,?)",[bid,ryan]);
      const nar = await one("SELECT id FROM narrators WHERE name=?",["Vikas Adam"]) ?? {id:uuid()};
      if (!(await one("SELECT 1 FROM narrators WHERE id=?",[nar.id]))) await q("INSERT INTO narrators (id,name) VALUES (?,?)",[nar.id,"Vikas Adam"]);
      await q("INSERT INTO book_narrators (book_id,narrator_id) VALUES (?,?) ON CONFLICT DO NOTHING",[bid,nar.id]);
      const n = await resolveByBook("ground-zero-vikas-adam","Fixed: author corrected to Nicholas Ryan; Vikas Adam moved to narrator (he narrated, didn't write it).");
      console.log(`Ground Zero: author→Nicholas Ryan, Vikas Adam→narrator, resolved ${n}`);
    } }

  // ── 2. Iron Gold II — duplicate of Iron Gold; the 1 user owns canonical → delete dupe ──
  { const dupe = await bookIdBySlug("iron-gold-ii-red-rising-4-part-2-pierce-brown");
    if (dupe) { const n = await resolveByBook("iron-gold-ii-red-rising-4-part-2-pierce-brown","Merged: deleted duplicate 'Iron Gold II' — the one user already owns the canonical Iron Gold."); await deleteBookFull(dupe); console.log(`Iron Gold II: deleted dupe, resolved ${n}`); } }

  // ── 3. Nicola Berry — drop Spanish + junk, keep 3, author Liane Moriarty, position ──
  { const liane = await findOrCreateAuthor("Liane Moriarty");
    const series = "8d7d8889-65de-4196-a144-5c90761e9e4a"; // "Nicola Berry"
    const keep = [["nicola-berry-and-the-petrifying-problem-with-princess-petronella",1],["nicola-berry-and-the-shocking-trouble-on-the-planet-of-shobble-2",2],["nicola-berry-and-the-wicked-war-on-the-planet-of-whimsy-3",3]] as [string,number][];
    for (const [slug,pos] of keep) { const bid = await bookIdBySlug(slug); if(bid){ await q("DELETE FROM book_authors WHERE book_id=?",[bid]); await q("INSERT INTO book_authors (book_id,author_id) VALUES (?,?)",[bid,liane]); await setSeries(bid,series,pos); } }
    for (const junk of ["nicola-berry-y-el-petrificante-problema-con-la-princesa-petronella-liane-moriarty","nicola-berry-2","nicola-berry-3","nicola-berry-1"]) { const bid = await bookIdBySlug(junk); if(bid){ await deleteBookFull(bid); console.log(`  - deleted ${junk}`); } }
    const n = await resolveByBook("nicola-berry-and-the-petrifying-problem-with-princess-petronella","Fixed: set author Liane Moriarty, linked the 3 English books as series #1-3, deleted Spanish edition + junk duplicates.");
    console.log(`Nicola Berry: cleaned + linked, resolved ${n}`); }

  // Helper to drive a full series (existing retitles + missing creates + positions)
  type Entry = { pos:number; title:string; slug?:string; retitle?:boolean };
  const driveSeries = async (seriesId:string, authorName:string, entries:Entry[]) => {
    const authorId = await findOrCreateAuthor(authorName);
    for (const e of entries) {
      let bid = e.slug ? await bookIdBySlug(e.slug) : null;
      if (bid) { if (e.retitle) await q("UPDATE books SET title=?, updated_at=datetime('now') WHERE id=?",[e.title,bid]); await setSeries(bid,seriesId,e.pos); }
      else await createBook(e.title, authorId, seriesId, e.pos);
    }
  };

  // ── 4. Ensnared / Dragon Captured ──
  { const series = await ensureSeries("The Dragon Captured");
    await driveSeries(series, "Bridget E. Baker", [
      {pos:1,title:"Ensnared",slug:"ensnared-bridget-e-baker"},
      {pos:2,title:"Entwined"},{pos:3,title:"Embroiled"},{pos:4,title:"Embattled"},
    ]);
    const n = await resolveByBook("ensnared-bridget-e-baker","Fixed: created 'The Dragon Captured' series, placed Ensnared as #1, added books 2-4 (Entwined/Embroiled/Embattled).");
    console.log(`Dragon Captured: series + Ensnared #1, resolved ${n}`); }

  // ── 5. UnderVerse — clean titles, dedupe Titan, drop junk, fill 8-12 ──
  { const series = "98a4aeb9-7719-4ba3-92d1-cba957454707";
    const dupTitan = await bookIdBySlug("titan-a-dark-fantasy-litrpg-adventure-jez-cajiao"); if(dupTitan){ await deleteBookFull(dupTitan); console.log("  - deleted duplicate Titan"); }
    const junk = await bookIdBySlug("jez-cajiao-kindle-store-jez-cajiao"); if(junk){ await deleteBookFull(junk); console.log("  - deleted 'Jez Cajiao: Kindle Store' junk"); }
    await driveSeries(series, "Jez Cajiao", [
      {pos:1,title:"Brightblade",slug:"brightblade-jez-cajiao"},
      {pos:2,title:"The Forgotten Faithful",slug:"forgotten-faithful-jez-cajiao",retitle:true},
      {pos:3,title:"City of Fallen Souls",slug:"city-of-fallen-souls-jez-cajiao"},
      {pos:4,title:"Titan",slug:"titan-jez-cajiao"},
      {pos:5,title:"Citadel",slug:"citadel-underverse-book-5-jez-cajiao",retitle:true},
      {pos:6,title:"Empire Ascendant",slug:"empire-ascendant-2nd-edition-underverse-book-6-jez-cajiao",retitle:true},
      {pos:7,title:"Dark Tide Rising",slug:"dark-tide-rising-jez-cajiao"},
      {pos:8,title:"Desert of the Soul"},{pos:9,title:"Tower of Gaij"},{pos:10,title:"Wrath Rising"},
      {pos:11,title:"The Soul Anchors"},{pos:12,title:"Divinity Denied"},
    ]);
    const n = await resolveBySeries(series,"Fixed: stripped marketing subtitles, deduped Titan, removed junk entry, set positions 1-12, created missing books 8-12.");
    console.log(`UnderVerse: cleaned + filled, resolved ${n}`); }

  // ── 6. Legends of Neverland (Mary Mecham) ──
  { const series = await ensureSeries("Legends of Neverland");
    await driveSeries(series, "Mary Mecham", [
      {pos:1,title:"Becoming Hook",slug:"becoming-hook-mary-mecham"},
      {pos:2,title:"Hunting Sirens"},{pos:3,title:"Betraying Korth"},{pos:4,title:"Escaping Pirates"},
      {pos:5,title:"Seeking Revenge"},{pos:6,title:"Training Shadows"},
    ]);
    const n = await resolveByBook("becoming-hook-mary-mecham","Fixed: created 'Legends of Neverland' series with all 6 books, Becoming Hook as #1.");
    console.log(`Neverland: series + 6 books, resolved ${n}`); }

  // ── 7. Partials Sequence (Dan Wells) — incl novella Isolation #0.5 ──
  { const series = "5a2399c3-a322-445e-9dff-d78323bc4a3d";
    await driveSeries(series, "Dan Wells", [
      {pos:0.5,title:"Isolation"},
      {pos:1,title:"Partials",slug:"partials-dan-wells"},
      {pos:2,title:"Fragments"},
      {pos:3,title:"Ruins",slug:"ruins-dan-wells"},
    ]);
    const n = await resolveBySeries(series,"Fixed: set positions (Isolation #0.5, Partials #1, Fragments #2, Ruins #3); created missing Isolation + Fragments.");
    console.log(`Partials: positions + novella, resolved ${n}`); }

  // ── 8. Throne of Glass — Assassin's Blade novellas + mark collections ──
  { const tog = "3fad9fe0-2ea8-407a-829e-3752dc5dfb26";
    for (const slug of ["the-assassins-blade-sarah-j-maas","the-assassins-blade-throne-of-glass-crown-of-midnight-heir-of-fire-queen-of-shadows-empire-of-storms-tower-of-dawn-kingdom-of-ash-sarah-j-maas"]) { const bid = await bookIdBySlug(slug); if(bid) await q("UPDATE books SET is_box_set=1, updated_at=datetime('now') WHERE id=?",[bid]); }
    await driveSeries(tog, "Sarah J. Maas", [
      {pos:0.1,title:"The Assassin and the Pirate Lord",slug:"the-assassin-and-the-pirate-lord-sarah-j-maas"},
      {pos:0.2,title:"The Assassin and the Healer"},
      {pos:0.3,title:"The Assassin and the Desert"},
      {pos:0.4,title:"The Assassin and the Underworld",slug:"the-assassin-and-the-underworld-sarah-j-maas"},
      {pos:0.5,title:"The Assassin and the Empire",slug:"the-assassin-and-the-empire-sarah-j-maas"},
    ]);
    const n = await resolveBySeries(tog,"Fixed (Option B): kept 'The Assassin's Blade' as a marked collection, AND split out all 5 individual novellas (#0.1-0.5); created the 2 missing ones (Healer, Desert).");
    const n2 = await resolveByBook("the-assassins-blade-sarah-j-maas","Fixed (Option B): collected novella book kept + marked as a collection; 5 individual novellas now exist as #0.1-0.5.");
    console.log(`Throne of Glass: novellas split + collections marked, resolved ${n+n2}`); }

  fs.writeFileSync("/tmp/new-book-ids.txt", newIds.join("\n"));
  console.log(`\n=== Created ${newIds.length} new books (ids → /tmp/new-book-ids.txt) for enrichment ===`);
  process.exit(0);
})().catch(e=>{console.error("FAILED:",e);process.exit(1);});
