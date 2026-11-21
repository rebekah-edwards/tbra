/**
 * Merge one user account INTO another (same person, two sign-ups).
 *
 *   npx tsx scripts/merge-user-accounts.ts <fromUserId> <intoUserId> [--apply] [--local]
 *
 * Dry run by default. --apply writes; --local targets data/tbra.db instead of prod Turso.
 * Run against prod first, then --local, so the mirror matches (sync never deletes).
 *
 * Rules:
 *  - user_book_state: books only FROM has move; on a shared book the newer updated_at
 *    wins (state/formats copied onto INTO's row) and the loser's row is dropped.
 *  - reading_sessions: move FROM's sessions for books where FROM won or INTO had nothing.
 *  - followers/following: repointed; duplicates (both already followed) dropped; no self-follows.
 *  - notifications, prefs INTO lacks, other single-owner rows: moved.
 *  - profile: display_name / avatar / bio / google_sub / apple_sub filled on INTO where empty.
 *  - FROM's username becomes a previous username of INTO (old profile links redirect).
 *  - FROM's whole footprint is archived to data/account-archives/ BEFORE any write,
 *    a deleted_accounts audit row (source 'merge') is written, then FROM is deleted.
 */
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { randomUUID, createHash } from "crypto";
dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true } as any);
dotenv.config({ path: path.resolve(process.cwd(), ".env.vercel.local"), override: true, quiet: true } as any);
import { createClient, type Client, type InStatement } from "@libsql/client";
import { createGuardedTurso } from "./lib/turso-guard";

const [FROM, INTO] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const APPLY = process.argv.includes("--apply");
const LOCAL = process.argv.includes("--local");
const USER_COL = /^(user_id|follower_id|followed_id|created_by|owner_id|referred_by_user_id|blocker_id|blocked_id|reporter_id|reviewer_id)$/;

(async () => {
  if (!FROM || !INTO || FROM === INTO) { console.error("usage: merge-user-accounts.ts <from> <into> [--apply] [--local]"); process.exit(1); }
  const db: Client = LOCAL
    ? createClient({ url: "file:data/tbra.db" })
    : (await createGuardedTurso({ name: "merge-user-accounts", maxRuntimeMs: 10 * 60_000 })).remote as unknown as Client;
  const q = async (sql: string, args: any[] = []) => (await db.execute({ sql, args })).rows as any[];
  const target = LOCAL ? "LOCAL" : "PROD";

  const from = (await q("select * from users where id=?", [FROM]))[0];
  const into = (await q("select * from users where id=?", [INTO]))[0];
  if (!from || !into) { console.error(`${target}: missing user from=${!!from} into=${!!into}`); process.exit(1); }
  console.log(`${target}: merging ${from.username} (${from.email}) → ${into.username} (${into.email}) ${APPLY ? "[APPLY]" : "[dry run]"}`);

  // Discover every column referencing users (FKs + naming convention).
  const tables = (await q("select name from sqlite_master where type='table' and name not like 'sqlite_%'")).map((r) => r.name as string);
  const refs: { t: string; c: string }[] = [];
  for (const t of tables) {
    if (t === "users" || t === "deleted_accounts") continue;
    const fk = (await q(`select "from" c, "table" tt from pragma_foreign_key_list(?)`, [t])).filter((r) => r.tt === "users").map((r) => r.c);
    const cols = (await q("select name from pragma_table_info(?)", [t])).map((r) => r.name).filter((c) => USER_COL.test(c));
    for (const c of new Set([...fk, ...cols])) refs.push({ t, c });
  }

  // Archive FROM's full footprint first.
  const footprint: Record<string, any[]> = {};
  let total = 0;
  for (const { t, c } of refs) {
    const rows = await q(`select * from ${t} where ${c}=?`, [FROM]);
    if (rows.length) { footprint[`${t}.${c}`] = rows.map((r) => ({ ...r })); total += rows.length; }
  }
  if (!LOCAL || APPLY) {
    const dir = path.resolve("data/account-archives"); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${from.username}-${FROM.slice(0, 8)}-merged-into-${into.username}-${target.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`);
    fs.writeFileSync(file, JSON.stringify({ archivedAt: new Date().toISOString(), source: target, mergedInto: INTO, user: { ...from }, totalRows: total, data: footprint }, null, 2));
    const back = JSON.parse(fs.readFileSync(file, "utf8"));
    if (back.totalRows !== total || back.user.id !== FROM) { console.error("archive verify FAILED"); process.exit(1); }
    console.log(`  archive: ${file} (${total} rows)`);
  }

  const stmts: InStatement[] = [];
  const log = (s: string) => console.log("  " + s);

  // --- user_book_state ---
  const intoBooks = new Map((await q("select * from user_book_state where user_id=?", [INTO])).map((r) => [r.book_id, r]));
  const fromBooks = await q("select s.*, b.title from user_book_state s join books b on b.id=s.book_id where s.user_id=?", [FROM]);
  const fromWins = new Set<string>();
  const ts = (v: any) => Date.parse(String(v ?? "").replace(" ", "T") + (String(v ?? "").match(/Z|[+-]\d\d:?\d\d$/) ? "" : "Z")) || 0;
  for (const r of fromBooks) {
    const mine = intoBooks.get(r.book_id);
    if (!mine) { fromWins.add(r.book_id); log(`move   ${r.state.padEnd(17)} ${r.title}`); continue; }
    if (ts(r.updated_at) > ts(mine.updated_at) && r.state !== mine.state) {
      fromWins.add(r.book_id);
      stmts.push({ sql: "delete from user_book_state where user_id=? and book_id=?", args: [INTO, r.book_id] });
      log(`newer  ${mine.state} → ${r.state.padEnd(10)} ${r.title}`);
    } else {
      stmts.push({ sql: "delete from user_book_state where user_id=? and book_id=?", args: [FROM, r.book_id] });
      log(`keep   ${mine.state.padEnd(17)} ${r.title} (dropping old ${r.state} @ ${r.updated_at})`);
    }
  }
  // move all remaining FROM rows (non-overlap + FROM-wins after INTO's loser row is deleted)
  stmts.push({ sql: "update user_book_state set user_id=? where user_id=?", args: [INTO, FROM] });

  // --- reading_sessions: keep FROM's only where FROM's state won ---
  for (const s of await q("select id, book_id from reading_sessions where user_id=?", [FROM])) {
    if (fromWins.has(s.book_id)) {
      // clear INTO's sessions for a book FROM won, then renumber safely by moving FROM's
      stmts.push({ sql: "delete from reading_sessions where user_id=? and book_id=?", args: [INTO, s.book_id] });
    } else stmts.push({ sql: "delete from reading_sessions where id=?", args: [s.id] });
  }
  stmts.push({ sql: "update reading_sessions set user_id=? where user_id=?", args: [INTO, FROM] });

  // --- follows ---
  stmts.push({ sql: "delete from user_follows where (follower_id=? and followed_id=?) or (follower_id=? and followed_id=?)", args: [FROM, INTO, INTO, FROM] });
  stmts.push({ sql: "delete from user_follows where followed_id=? and follower_id in (select follower_id from user_follows where followed_id=?)", args: [FROM, INTO] });
  stmts.push({ sql: "delete from user_follows where follower_id=? and followed_id in (select followed_id from user_follows where follower_id=?)", args: [FROM, INTO] });
  stmts.push({ sql: "update user_follows set followed_id=? where followed_id=?", args: [INTO, FROM] });
  stmts.push({ sql: "update user_follows set follower_id=? where follower_id=?", args: [INTO, FROM] });

  // --- everything else FROM still owns: move if INTO has no row, otherwise throw (handled below) ---
  const handled = new Set(["user_book_state.user_id", "reading_sessions.user_id", "user_follows.follower_id", "user_follows.followed_id"]);
  for (const key of Object.keys(footprint)) {
    if (handled.has(key)) continue;
    const [t, c] = key.split(".");
    if (t === "auth_refresh_tokens" || t === "password_reset_tokens") { stmts.push({ sql: `delete from ${t} where ${c}=?`, args: [FROM] }); log(`drop   ${footprint[key].length} ${t}`); continue; }
    if (t === "user_previous_usernames") { stmts.push({ sql: `update ${t} set ${c}=? where ${c}=?`, args: [INTO, FROM] }); continue; }
    const intoHas = (await q(`select count(*) n from ${t} where ${c}=?`, [INTO]))[0].n;
    if (intoHas && /preferences$/.test(t)) { stmts.push({ sql: `delete from ${t} where ${c}=?`, args: [FROM] }); log(`drop   ${t} (INTO already has its own)`); continue; }
    stmts.push({ sql: `update ${t} set ${c}=? where ${c}=?`, args: [INTO, FROM] });
    log(`move   ${footprint[key].length} ${key}`);
  }

  // --- profile ---
  const fill = ["display_name", "avatar_url", "bio", "location", "instagram", "tiktok", "threads", "twitter", "google_sub", "apple_sub", "timezone"]
    .filter((k) => k in from && from[k] != null && into[k] == null);
  const uniq = fill.filter((k) => k.endsWith("_sub"));
  if (uniq.length) stmts.push({ sql: `update users set ${uniq.map((k) => `${k}=NULL`).join(",")} where id=?`, args: [FROM] });
  if (fill.length) stmts.push({ sql: `update users set ${fill.map((k) => `${k}=?`).join(",")}, updated_at=? where id=?`, args: [...fill.map((k) => from[k]), new Date().toISOString(), INTO] });
  log(`profile fill: ${fill.join(", ") || "(none)"}`);

  // audit + delete FROM, then old handle redirects to INTO
  stmts.push({ sql: "update users set referred_by_user_id=? where referred_by_user_id=?", args: [INTO, FROM] });
  stmts.push({ sql: "insert into deleted_accounts (id,user_id,email_sha256,email_domain,username,source,account_created_at,deleted_at,rows_deleted) values (?,?,?,?,?,?,?,?,?)",
    args: [randomUUID(), FROM, createHash("sha256").update(String(from.email).trim().toLowerCase()).digest("hex"), String(from.email).split("@")[1]?.toLowerCase() ?? null, from.username, `merge:${INTO}`, from.created_at, new Date().toISOString(), 0] });
  stmts.push({ sql: "delete from users where id=?", args: [FROM] });
  stmts.push({ sql: "insert or ignore into user_previous_usernames (username,user_id,changed_at) values (?,?,datetime('now'))", args: [String(from.username).toLowerCase(), INTO] });

  if (!APPLY) { console.log(`  ${stmts.length} statements prepared — dry run, nothing written.`); process.exit(0); }
  await db.batch(stmts, "write");   // atomic: all or nothing
  for (const { t, c } of refs) {
    const n = (await q(`select count(*) n from ${t} where ${c}=?`, [FROM]))[0].n;
    if (n) { console.error(`  LEFTOVER ${t}.${c}=${n}`); process.exitCode = 1; }
  }
  const after = await q("select (select count(*) from user_book_state where user_id=?) books, (select count(*) from reading_sessions where user_id=?) sessions, (select count(*) from user_follows where followed_id=?) followers, (select count(*) from users where id=?) old_user", [INTO, INTO, INTO, FROM]);
  console.log(`  done:`, after[0]);
  process.exit(process.exitCode ?? 0);
})().catch((e) => { console.error("FAILED:", e); process.exit(1); });
