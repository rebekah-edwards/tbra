/**
 * sync-pull.ts — Pull production Turso changes into local SQLite via @libsql/client.
 *
 * Replaces the Turso-CLI-based pull in sync-incremental.sh (that CLI is authed to
 * `tbra-rebekah-edwards`, not the production DB `tbra-web-app-thebasedreaderapp`).
 *
 * Semantics, mirroring the original Python pull:
 *   - For each table with a primary key, INSERT rows that exist on live but not locally.
 *   - For tables with `updated_at`, UPDATE local rows when live has a newer timestamp.
 *   - Live covers are authoritative: always overwrite local cover_image_url with live value.
 *   - Never deletes local rows (user-facing tables must not lose data).
 */

require('dotenv').config({ path: '.env.vercel.local' });
const { createClient } = require('@libsql/client');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

// ─── PID lockfile: prevent parallel sync-pull runs ───
// See the 2026-04-20 postmortem: multiple concurrent sync-pull/sync-push
// processes saturated Turso connections and degraded live-site responsiveness.
const LOCK_PATH = '/tmp/tbra-sync-pull.lock';
(function acquireLock() {
  try {
    const existing = fs.readFileSync(LOCK_PATH, 'utf8').trim();
    const pid = parseInt(existing, 10);
    if (pid && Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        console.error(`ERROR: sync-pull already running (PID ${pid}). Remove ${LOCK_PATH} to override.`);
        process.exit(2);
      } catch {
        console.log(`Stale lockfile (PID ${pid} no longer running). Taking over.`);
      }
    }
  } catch { /* no lockfile */ }
  fs.writeFileSync(LOCK_PATH, String(process.pid));
  const cleanup = () => { try { fs.unlinkSync(LOCK_PATH); } catch {} };
  process.on('exit', cleanup);
  process.on('SIGINT',  () => { cleanup(); process.exit(130); });
  process.on('SIGTERM', () => { cleanup(); process.exit(143); });
  process.on('uncaughtException', (e: Error) => { console.error(e); cleanup(); process.exit(1); });
})();

if (!process.env.TURSO_DATABASE_URL || !process.env.TURSO_AUTH_TOKEN) {
  console.error('ERROR: TURSO_DATABASE_URL or TURSO_AUTH_TOKEN missing from .env.vercel.local');
  console.error('Run: npx vercel env pull');
  process.exit(1);
}

const remote = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const local = new Database(path.join(process.cwd(), 'data', 'tbra.db'));
local.pragma('foreign_keys = OFF');

// ─── Per-query timeout + stall detector (mirror of sync-push) ───
const QUERY_TIMEOUT_MS = 30_000;
const STALL_TIMEOUT_MS = 5 * 60_000;
let lastProgressMs = Date.now();
function markProgress() { lastProgressMs = Date.now(); }

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`sync-pull ${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(t); markProgress(); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
const _origExecute = remote.execute.bind(remote);
remote.execute = ((arg: any) => withTimeout(_origExecute(arg), QUERY_TIMEOUT_MS, 'execute')) as typeof remote.execute;
const _origBatch = remote.batch.bind(remote);
remote.batch = ((args: any, mode?: any) => withTimeout(_origBatch(args, mode), QUERY_TIMEOUT_MS, 'batch')) as typeof remote.batch;

const stallInterval = setInterval(() => {
  const idle = Date.now() - lastProgressMs;
  if (idle > STALL_TIMEOUT_MS) {
    console.error(`FATAL: sync-pull stalled — no progress for ${Math.round(idle / 1000)}s. Aborting.`);
    try { require('fs').unlinkSync('/tmp/tbra-sync-pull.lock'); } catch {}
    process.exit(3);
  }
}, 30_000).unref();
void stallInterval;

// Tables to sync in order — (table, pk_columns, has_updated_at)
const TABLES: Array<[string, string[], boolean]> = [
  ['users',                    ['id'],                    false],
  ['books',                    ['id'],                    true],
  ['authors',                  ['id'],                    false],
  ['series',                   ['id'],                    false],
  ['genres',                   ['id'],                    false],
  ['narrators',                ['id'],                    false],
  ['editions',                 ['id'],                    false],
  ['book_authors',             ['book_id', 'author_id'],  false],
  ['book_genres',              ['book_id', 'genre_id'],   false],
  ['book_series',              ['book_id', 'series_id'],  false],
  ['book_narrators',           ['book_id', 'narrator_id'],false],
  ['book_category_ratings',    ['id'],                    true],
  ['links',                    ['id'],                    false],
  // ⚠️ User-activity tables WITH an updated_at column MUST be flagged true —
  // they change on BOTH sides (live site + native app). They were insert-only
  // until 2026-07-02, which froze every state change made on the live site
  // out of local: the native app showed months-stale "currently reading".
  // The newer-timestamp rule keeps bidirectional writes safe in both
  // directions. (Tables flagged false here genuinely have no updated_at.)
  ['user_book_state',          ['user_id', 'book_id'],    true],
  ['user_book_ratings',        ['user_id', 'book_id'],    true],
  ['user_book_reviews',        ['id'],                    true],
  ['user_favorite_books',      ['user_id', 'book_id'],    false],
  ['user_hidden_books',        ['user_id', 'book_id'],    false],
  ['user_follows',             ['follower_id', 'followed_id'], false],
  ['author_follows',           ['user_id', 'author_id'],  false],
  ['shelf_follows',            ['user_id', 'shelf_id'],   false],
  ['tbr_notes',                ['id'],                    true],
  ['user_owned_editions',      ['user_id', 'edition_id'], false],
  ['user_content_preferences', ['user_id', 'category_id'],false],
  ['user_reading_preferences', ['user_id'],               true],
  ['user_genre_preferences',   ['user_id', 'genre_name'], false],
  ['user_notification_preferences', ['user_id'],          true],
  ['reading_goals',            ['id'],                    true],
  ['reading_sessions',         ['id'],                    true],
  ['reading_notes',            ['id'],                    false],
  // up_next is NOT in this list on purpose — it gets a dedicated whole-queue
  // mirror step below. Insert-only pulling could never work for it: removals
  // and reorders leave no per-row trace, and the UNIQUE(user_id, position)
  // index made stale local rows silently BLOCK the live queue's inserts
  // (users saw a months-old queue in the native app).
  ['review_descriptor_tags',   ['id'],                    false],
  ['review_helpful_votes',     ['user_id', 'review_id'],  false],
  ['user_book_dimension_ratings', ['id'],                 false],
  ['reported_issues',          ['id'],                    false],
  ['report_corrections',       ['id'],                    false],
  ['enrichment_log',           ['id'],                    false],
  ['rating_citations',         ['rating_id', 'citation_id'], false],
];

function localCols(table: string): string[] {
  try {
    const rows = local.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return rows.map((r) => r.name);
  } catch {
    return [];
  }
}

function pkSetLocal(table: string, pk: string[]): Set<string> {
  const set = new Set<string>();
  const cols = pk.join(', ');
  const rows = local.prepare(`SELECT ${cols} FROM ${table}`).all() as any[];
  for (const r of rows) set.add(pk.map((c) => String(r[c])).join('\x1f'));
  return set;
}

async function fetchLiveRows(table: string, cols: string[], page = 5000): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  while (true) {
    const r = await remote.execute(
      `SELECT ${cols.join(',')} FROM ${table} ORDER BY ${cols[0]} LIMIT ${page} OFFSET ${offset}`
    );
    if (r.rows.length === 0) break;
    for (const row of r.rows as any[]) rows.push(row);
    if (r.rows.length < page) break;
    offset += page;
  }
  return rows;
}

(async () => {
  console.log('→ Pulling live changes into local SQLite via @libsql/client\n');

  let totalInserted = 0;
  let totalUpdated = 0;
  const errors: string[] = [];

  for (const [table, pkCols, hasUpdatedAt] of TABLES) {
    const cols = localCols(table);
    if (cols.length === 0) {
      console.log(`  ·  ${table.padEnd(35)} skipped (not in local DB)`);
      continue;
    }

    let liveRows: any[];
    try {
      liveRows = await fetchLiveRows(table, cols);
    } catch (e: any) {
      errors.push(`${table} fetch: ${e.message}`);
      console.log(`  ✗  ${table}: fetch failed (${e.message.slice(0, 80)})`);
      continue;
    }

    if (liveRows.length === 0) {
      console.log(`  ·  ${table.padEnd(35)} empty on live`);
      continue;
    }

    const localPkSet = pkSetLocal(table, pkCols);

    const insertSql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    const insertStmt = local.prepare(insertSql);

    let updateStmt: any = null;
    let getLocalUpdated: any = null;
    if (hasUpdatedAt) {
      const setClause = cols.filter((c) => !pkCols.includes(c)).map((c) => `${c} = ?`).join(', ');
      const whereClause = pkCols.map((c) => `${c} = ?`).join(' AND ');
      updateStmt = local.prepare(`UPDATE ${table} SET ${setClause} WHERE ${whereClause}`);
      getLocalUpdated = local.prepare(
        `SELECT updated_at FROM ${table} WHERE ${whereClause}`
      );
    }

    let inserted = 0;
    let updated = 0;

    // Run inside a transaction for speed
    const trx = local.transaction((rows: any[]) => {
      for (const row of rows) {
        const pkKey = pkCols.map((c) => String(row[c])).join('\x1f');

        if (!localPkSet.has(pkKey)) {
          try {
            insertStmt.run(...cols.map((c) => row[c]));
            inserted++;
          } catch (e: any) {
            if (!String(e.message).includes('UNIQUE constraint')) {
              errors.push(`${table} insert: ${e.message.slice(0, 100)}`);
            }
          }
        } else if (hasUpdatedAt) {
          const liveUpdated = row['updated_at'];
          if (!liveUpdated) continue;
          const localRow = getLocalUpdated.get(...pkCols.map((c) => row[c]));
          const localUpdated = localRow ? localRow.updated_at : null;
          // A local row with NULL updated_at has never been touched locally —
          // treat it as older than any live timestamp (previously such rows
          // could never be updated at all).
          if (!localUpdated || liveUpdated > localUpdated) {
            try {
              const nonPkVals = cols.filter((c) => !pkCols.includes(c)).map((c) => row[c]);
              const pkVals = pkCols.map((c) => row[c]);
              updateStmt.run(...nonPkVals, ...pkVals);
              updated++;
            } catch (e: any) {
              errors.push(`${table} update: ${e.message.slice(0, 100)}`);
            }
          }
        }
      }
    });
    trx(liveRows);

    const parts: string[] = [];
    if (inserted) parts.push(`+${inserted} new`);
    if (updated) parts.push(`~${updated} updated`);
    if (parts.length === 0) parts.push('in sync');
    const icon = inserted || updated ? '✓' : '·';
    console.log(`  ${icon}  ${table.padEnd(35)} ${parts.join(', ')}`);

    totalInserted += inserted;
    totalUpdated += updated;
  }

  // ─── Up Next queue mirror (newest side wins) ───
  // The queue has no per-row update trail — deletes and reorders leave
  // nothing behind — so it syncs as ONE UNIT per user: whichever side was
  // touched most recently (MAX(COALESCE(updated_at, added_at))) replaces the
  // other. This step handles live-is-newer (or tied); sync-push step 5f
  // handles local-newer. A user with rows ONLY locally is left alone (an
  // emptied live queue is indistinguishable from unpushed local adds — we
  // never destroy data over that ambiguity).
  console.log('\n→ Syncing up_next queues (whole-queue mirror, newest side wins)');
  try {
    const liveUpNext = (await remote.execute(
      'SELECT id, user_id, book_id, position, added_at, updated_at FROM up_next'
    )).rows as any[];
    const liveByUser = new Map<string, any[]>();
    for (const r of liveUpNext) {
      const key = String(r.user_id);
      const list = liveByUser.get(key) ?? [];
      list.push(r);
      liveByUser.set(key, list);
    }
    const localMaxRows = local.prepare(
      'SELECT user_id, MAX(COALESCE(updated_at, added_at)) AS m FROM up_next GROUP BY user_id'
    ).all() as any[];
    const localMax = new Map(localMaxRows.map((r: any) => [String(r.user_id), String(r.m ?? '')]));
    const localBookIds = new Set(
      (local.prepare('SELECT id FROM books').all() as any[]).map((r) => String(r.id))
    );

    const delStmt = local.prepare('DELETE FROM up_next WHERE user_id = ?');
    const insStmt = local.prepare(
      'INSERT INTO up_next (id, user_id, book_id, position, added_at, updated_at) VALUES (?,?,?,?,?,?)'
    );
    let mirrored = 0;
    let leftLocalNewer = 0;
    for (const [userId, rows] of liveByUser) {
      const liveMax = rows.reduce((m, r) => {
        const v = String(r.updated_at ?? r.added_at ?? '');
        return v > m ? v : m;
      }, '');
      if ((localMax.get(userId) ?? '') > liveMax) { leftLocalNewer++; continue; }
      // FK guard: the books table was pulled above, but skip any row whose
      // book still isn't local rather than failing the whole queue.
      const insertable = rows.filter((r) => localBookIds.has(String(r.book_id)));
      local.transaction(() => {
        delStmt.run(userId);
        for (const r of insertable) {
          insStmt.run(r.id, r.user_id, r.book_id, r.position, r.added_at, r.updated_at ?? null);
        }
      })();
      mirrored++;
    }
    markProgress();
    const note = leftLocalNewer ? `, left ${leftLocalNewer} local-newer queue(s) for sync-push` : '';
    console.log(`  ✓  up_next: mirrored ${mirrored} queue(s) live→local${note}`);
  } catch (e: any) {
    errors.push(`up_next mirror: ${e.message.slice(0, 100)}`);
    console.log(`  ✗  up_next mirror: ${e.message.slice(0, 100)}`);
  }

  // Always sync covers live → local (live is authoritative).
  // Pull cover_image_url, cover_source, and cover_verified together — otherwise
  // a `manual` flag set on live via /admin/covers gets stripped on the next
  // push (step 5b pushes local cover_source back on top of the live value).
  console.log('\n→ Syncing covers (live → local; live covers authoritative)');
  try {
    const liveCovers = await remote.execute(
      `SELECT id, cover_image_url, cover_source, cover_verified
         FROM books
        WHERE cover_image_url IS NOT NULL AND cover_image_url != ''`
    );
    let coverFixed = 0;
    const updateCover = local.prepare(
      `UPDATE books
          SET cover_image_url = ?,
              cover_source    = ?,
              cover_verified  = ?
        WHERE id = ?
          AND (cover_image_url IS NULL
               OR cover_image_url  != ?
               OR IFNULL(cover_source,   '') != IFNULL(?, '')
               OR IFNULL(cover_verified, 0)  != IFNULL(?, 0))`
    );
    const trx = local.transaction((rows: any[]) => {
      for (const row of rows) {
        const res = updateCover.run(
          row.cover_image_url,
          row.cover_source,
          row.cover_verified,
          row.id,
          row.cover_image_url,
          row.cover_source,
          row.cover_verified,
        );
        if (res.changes > 0) coverFixed++;
      }
    });
    trx(liveCovers.rows);
    console.log(`  ✓  covers                              ${coverFixed} synced from live`);
  } catch (e: any) {
    console.log(`  ⚠  cover sync: ${e.message.slice(0, 120)}`);
  }

  // Audiobook covers are live-authoritative too — the admin uploads them on
  // the live site (/admin/covers Audiobook tab or the book-page editor), and
  // the app's square-audiobook display reads the LOCAL row. Historically
  // setAudiobookCover didn't bump books.updated_at, so the timestamp path
  // above never carried these; this pass mirrors them unconditionally
  // (found 2026-07-11: Remarkably Bright Creatures).
  console.log('\n→ Syncing audiobook covers (live → local; live authoritative)');
  try {
    const liveAudio = await remote.execute(
      `SELECT id, audiobook_cover_url
         FROM books
        WHERE audiobook_cover_url IS NOT NULL AND audiobook_cover_url != ''`
    );
    let audioFixed = 0;
    const updateAudio = local.prepare(
      `UPDATE books
          SET audiobook_cover_url = ?
        WHERE id = ?
          AND (audiobook_cover_url IS NULL OR audiobook_cover_url != ?)`
    );
    const trxAudio = local.transaction((rows: any[]) => {
      for (const row of rows) {
        const res = updateAudio.run(row.audiobook_cover_url, row.id, row.audiobook_cover_url);
        if (res.changes > 0) audioFixed++;
      }
    });
    trxAudio(liveAudio.rows);
    console.log(`  ✓  audiobook covers                    ${audioFixed} synced from live`);
  } catch (e: any) {
    console.log(`  ⚠  audiobook cover sync: ${e.message.slice(0, 120)}`);
  }

  console.log('\n────────────────────────────────────');
  console.log(`Totals: ${totalInserted} rows inserted, ${totalUpdated} rows updated`);
  if (errors.length > 0) {
    console.log(`\n${errors.length} errors (showing first 10):`);
    for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  }
  console.log('\nPull complete.');

  local.close();
  // The Turso libSQL client keeps an open socket that holds the event loop
  // alive after all work is done. Without an explicit exit the process hangs
  // until the unref'd stall watchdog fires and kills the chain with exit 3
  // (observed 2026-06-25: pull finished, then aborted at 319s before import ran).
  try { remote.close(); } catch {}
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
