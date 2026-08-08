/**
 * sync-user-activity.ts — fast BIDIRECTIONAL sync of user-activity tables
 * between local SQLite and production Turso.
 *
 * Why this exists (2026-07-12): the native app writes reading activity to the
 * LOCAL db (via the v1 API over Tailscale) while the web app writes to Turso.
 * The nightly pull only INSERTs/UPDATEs live→local, and nightly sync-push has
 * NO user-activity step at all (only up_next) — so app-side activity never
 * reached live, and live rows whose natural key collided with a locally
 * created row (same user+book+read_number under a DIFFERENT id) were silently
 * skipped forever. Rebekah's stats showed 27 books on web vs 26 in the app.
 *
 * Semantics per table, both directions, newest-wins:
 *   - Row exists on one side only (by PK)      → INSERT into the other side.
 *   - INSERT hits a natural-key UNIQUE index    → MERGE: compare updated_at;
 *     the newer row's values win. Locally we ADOPT THE LIVE ROW (delete the
 *     local twin, re-point child FKs, insert live's row) so ids converge on
 *     live's id over time; on live we UPDATE the existing row in place (live
 *     ids are canonical — we never delete live rows).
 *   - Row exists on both sides + has updated_at → UPDATE whichever side is
 *     older with the newer side's values.
 *   - Tables without updated_at are insert-only in both directions.
 *   - up_next syncs as a whole queue per user, newest side wins (same rule
 *     as sync-pull / sync-push 5f).
 *   - NOTHING is ever deleted on live; locally only a natural-key twin being
 *     replaced by its live counterpart is deleted.
 *
 * PUSH SAFETY FILTER: the →live direction only moves rows belonging to the
 * accounts that actually write through the local v1 API (Rebekah + the test
 * account), and only rows stamped since the native-app era began. Everything
 * else that's local-only is a GHOST of a live-side deletion (pull never
 * deletes locally — verified 2026-07-12: 57 local-only reviews / 83 sessions,
 * overwhelmingly other web users' rows cascade-deleted on live by book merges
 * and account cleanups). Pushing those would resurrect deleted content.
 *
 * Runs standalone every 30 min (scheduled task `user-activity-sync`) and as
 * the tail of `sync-incremental.sh push` so the nightly chain converges too.
 */

require('dotenv').config({ path: '.env.vercel.local' });
const Database = require('better-sqlite3');
const path = require('path');
const fsSync = require('fs');
const { createGuardedTurso } = require('./lib/turso-guard');
const { fileAdminAlert, resolveAdminAlert } = require('./lib/admin-alert');
const { SYNCABLE_USER_IDS } = require('../src/lib/sync/app-users');

/**
 * Consecutive-failure escalation (added 2026-07-30).
 *
 * This script used to run as a Claude scheduled task whose SKILL.md told the
 * session: "file a deduped issue ONLY if the same error persists across 3+
 * consecutive runs" — a one-off FOREIGN KEY error usually just means a
 * locally-created book hasn't been pushed yet, and those self-heal. Running 34×
 * a day, that judgment call was also 76% of the resident-Claude-session pileup
 * that saturated the Mac (see memory project_mac_process_pileup), so the task
 * moved to launchd and the rule moved here, where a counter file does it
 * deterministically and for free.
 */
const ERROR_STATE_FILE = path.join(__dirname, '..', 'data', 'user-activity-sync-errors.json');
const ESCALATE_AFTER_RUNS = 3;

/** Bucket an error string to the table it came from: "up_next: foo" → "up_next". */
function errorKey(message: string): string {
  return String(message).split(/[:\s]/)[0] || 'unknown';
}

function readErrorState(): Record<string, number> {
  try {
    return JSON.parse(fsSync.readFileSync(ERROR_STATE_FILE, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeErrorState(state: Record<string, number>) {
  try {
    fsSync.mkdirSync(path.dirname(ERROR_STATE_FILE), { recursive: true });
    fsSync.writeFileSync(ERROR_STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e: any) {
    console.log(`  (could not persist error state: ${e.message})`);
  }
}

/**
 * Bump the streak for every table that errored this run, clear the streak for
 * every table that didn't, and file/resolve /admin/issues alerts at the
 * threshold. Never throws — alerting must not fail the sync itself.
 */
async function escalatePersistentErrors(remote: any, errors: string[]) {
  try {
    const previous = readErrorState();
    const failedNow = new Set(errors.map(errorKey));
    const next: Record<string, number> = {};

    for (const key of failedNow) {
      next[key] = (previous[key] ?? 0) + 1;
    }

    for (const key of failedNow) {
      if (next[key] < ESCALATE_AFTER_RUNS) continue;
      const sample = errors.find((e) => errorKey(e) === key) ?? key;
      const filed = await fileAdminAlert(remote, {
        tag: 'user-activity-sync',
        key,
        description:
          `"${key}" has failed ${next[key]} consecutive user-activity syncs. Latest: ${sample}. `
          + `Runs every 30 min via launchd (com.tbra.user-activity-sync); log at data/user-activity-sync.log. `
          + `A persistent failure here means reading activity is diverging between the iOS app (local DB) and the web app (Turso).`,
      });
      if (filed) console.log(`  ⚠ filed /admin/issues alert: ${key} failing ${next[key]} runs in a row`);
    }

    // Anything that failed before but succeeded now → streak broken, close the alert.
    for (const key of Object.keys(previous)) {
      if (failedNow.has(key)) continue;
      if (previous[key] >= ESCALATE_AFTER_RUNS) {
        const closed = await resolveAdminAlert(remote, {
          tag: 'user-activity-sync',
          key,
          resolution: `Recovered: "${key}" synced cleanly on a later run.`,
        });
        if (closed > 0) console.log(`  ✓ auto-resolved ${closed} stale alert(s) for ${key}`);
      }
    }

    writeErrorState(next);
  } catch (e: any) {
    console.log(`  (error escalation skipped: ${e.message})`);
  }
}

type TableSpec = {
  name: string;
  pk: string[];
  hasUpdatedAt: boolean;
  /** Non-PK UNIQUE index columns — triggers merge instead of silent skip. */
  naturalKey?: string[];
  /** Child tables referencing this table's id (re-pointed when a local row
      is replaced by its live twin). */
  childRefs?: Array<[string, string]>;
  /** Column identifying the owning user (default 'user_id'); 'id' on users. */
  userCol?: string;
  /** Never push this table →live (live is authoritative for it). */
  noPush?: boolean;
  /** Rows have no user column — owner resolves through shelves.user_id. */
  ownerViaShelf?: boolean;
};

/** Accounts that write through the local v1 API (the native app).
    Shared with the /import route guard via src/lib/sync/app-users.ts so the two
    can never disagree about who is pushable — that drift is what let real
    testers' libraries strand here unnoticed. */
const APP_USERS = new Set(SYNCABLE_USER_IDS);
/** Rows older than this can't be app-created — the native app didn't exist. */
const APP_ERA = '2026-06-20';

/**
 * ONE-OFF BACKFILL ESCAPE HATCH (added 2026-07-30).
 *
 * The guards above are correct for the recurring 30-min sync: they stop local ghosts from
 * resurrecting on prod. But they also mean data imported LOCALLY on a tester's behalf
 * (scripts/run-goodreads-import.ts writes to local sqlite) can NEVER reach production —
 * which is how myerschar9 ended up with a 1,169-book library on local and an EMPTY library
 * on thebasedreader.app.
 *
 * These env overrides let a human deliberately push a named user's stranded rows through
 * the SAME tested code path (natural keys, childRefs, conflict handling) instead of a
 * hand-rolled INSERT script that would strand review child rows.
 *
 *   PUSH_USERS=<uuid,uuid>   additional owner ids allowed to push
 *   PUSH_ERA=<YYYY-MM-DD>    relax the era gate (imported rows carry historical timestamps)
 *
 * Never set these in the scheduled job. One-off, supervised use only.
 */
const PUSH_USERS_OVERRIDE = (process.env.PUSH_USERS ?? '')
  .split(',').map((s) => s.trim()).filter(Boolean);
for (const id of PUSH_USERS_OVERRIDE) APP_USERS.add(id);
const APP_ERA_EFFECTIVE = process.env.PUSH_ERA?.trim() || APP_ERA;
if (PUSH_USERS_OVERRIDE.length > 0) {
  console.warn(
    `⚠️  PUSH OVERRIDE ACTIVE: +${PUSH_USERS_OVERRIDE.length} user(s), era=${APP_ERA_EFFECTIVE}`,
  );
}

/** shelf_books rows carry no user column — resolve the owner via the
    LOCAL shelves table (populated lazily). */
let localShelfOwner: Map<string, string> | null = null;

/** May this local row be pushed to live? (Ghost-resurrection guard.) */
function pushable(spec: TableSpec, row: any): boolean {
  if (spec.noPush) return false;
  const owner = spec.ownerViaShelf
    ? localShelfOwner?.get(String(row.shelf_id))
    : row[spec.userCol ?? 'user_id'];
  if (!owner || !APP_USERS.has(String(owner))) return false;
  const stamps = [row.updated_at, row.created_at, row.added_at].filter(Boolean).map(String);
  if (stamps.length === 0) return true; // no timestamp columns — user filter only
  return stamps.some((s) => s >= APP_ERA_EFFECTIVE);
}

const TABLES: TableSpec[] = [
  { name: 'users',                      pk: ['id'], hasUpdatedAt: true, userCol: 'id', noPush: true },
  { name: 'user_book_state',            pk: ['user_id', 'book_id'], hasUpdatedAt: true },
  { name: 'user_book_ratings',          pk: ['id'], hasUpdatedAt: true, naturalKey: ['user_id', 'book_id'] },
  { name: 'user_book_reviews',          pk: ['id'], hasUpdatedAt: true, naturalKey: ['user_id', 'book_id'],
    childRefs: [['user_book_dimension_ratings', 'review_id'], ['review_descriptor_tags', 'review_id'], ['review_helpful_votes', 'review_id']] },
  { name: 'user_book_dimension_ratings', pk: ['id'], hasUpdatedAt: false, naturalKey: ['review_id', 'dimension'] },
  { name: 'review_descriptor_tags',     pk: ['id'], hasUpdatedAt: false, naturalKey: ['review_id', 'dimension', 'tag'] },
  { name: 'review_helpful_votes',       pk: ['user_id', 'review_id'], hasUpdatedAt: false },
  { name: 'user_favorite_books',        pk: ['user_id', 'book_id'], hasUpdatedAt: false },
  { name: 'user_hidden_books',          pk: ['user_id', 'book_id'], hasUpdatedAt: false },
  { name: 'user_follows',               pk: ['follower_id', 'followed_id'], hasUpdatedAt: false, userCol: 'follower_id' },
  { name: 'author_follows',             pk: ['user_id', 'author_id'], hasUpdatedAt: false },
  // Shelves + their contents were absent from EVERY sync path until
  // 2026-07-13 — a followed live shelf didn't exist locally, so the app's
  // Following tab came back empty. shelves must sync before shelf_follows/
  // shelf_books so their FK targets exist.
  { name: 'shelves',                    pk: ['id'], hasUpdatedAt: true, naturalKey: ['user_id', 'slug'] },
  { name: 'shelf_books',                pk: ['shelf_id', 'book_id'], hasUpdatedAt: false, ownerViaShelf: true },
  { name: 'shelf_follows',              pk: ['user_id', 'shelf_id'], hasUpdatedAt: false },
  { name: 'tbr_notes',                  pk: ['id'], hasUpdatedAt: true, naturalKey: ['user_id', 'book_id'] },
  { name: 'reading_goals',              pk: ['id'], hasUpdatedAt: true, naturalKey: ['user_id', 'year'] },
  { name: 'reading_sessions',           pk: ['id'], hasUpdatedAt: true, naturalKey: ['user_id', 'book_id', 'read_number'] },
  { name: 'reading_notes',              pk: ['id'], hasUpdatedAt: false },
  { name: 'user_owned_editions',        pk: ['user_id', 'edition_id'], hasUpdatedAt: false },
  { name: 'user_content_preferences',   pk: ['user_id', 'category_id'], hasUpdatedAt: true },  // updated_at added 2026-07-15
  { name: 'user_reading_preferences',   pk: ['user_id'], hasUpdatedAt: true },
  { name: 'user_genre_preferences',     pk: ['user_id', 'genre_name'], hasUpdatedAt: false },
  { name: 'user_notification_preferences', pk: ['user_id'], hasUpdatedAt: true },
  { name: 'discover_usage',             pk: ['user_id', 'month'], hasUpdatedAt: true },  // free-tier Discover meter (2026-07-15)
];

(async () => {
  const { remote, shutdown } = await createGuardedTurso({
    name: 'sync-user-activity',
    // 15 min is right for the recurring 30-min job. A supervised one-off backfill
    // (PUSH_USERS) moves thousands of rows and needs longer — raise it explicitly
    // via SYNC_MAX_MINUTES rather than loosening the default for the cron path.
    maxRuntimeMs: Number(process.env.SYNC_MAX_MINUTES ?? 15) * 60 * 1000,
    queryTimeoutMs: 30_000,
  });
  const local = new Database(path.join(process.cwd(), 'data', 'tbra.db'));
  local.pragma('foreign_keys = OFF');

  const key = (row: any, cols: string[]) => cols.map((c) => String(row[c])).join('\x1f');

  function localCols(table: string): string[] {
    try {
      return (local.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((r) => r.name);
    } catch { return []; }
  }

  async function fetchLive(table: string, cols: string[]): Promise<any[]> {
    const rows: any[] = [];
    let offset = 0;
    const page = 5000;
    while (true) {
      const r = await remote.execute(
        `SELECT ${cols.join(',')} FROM ${table} ORDER BY ${cols[0]} LIMIT ${page} OFFSET ${offset}`);
      for (const row of r.rows as any[]) rows.push(row);
      if (r.rows.length < page) break;
      offset += page;
    }
    return rows;
  }

  let totals = { toLocal: 0, toLive: 0, mergedLocal: 0, mergedLive: 0, errors: 0 };
  const errors: string[] = [];

  for (const spec of TABLES) {
    const cols = localCols(spec.name);
    if (cols.length === 0) { console.log(`  ·  ${spec.name.padEnd(34)} not in local DB`); continue; }

    // Owner map for shelf_books' push filter — rebuilt here so it reflects
    // shelves pulled earlier in this same run (shelves precedes it in TABLES).
    if (spec.ownerViaShelf) {
      localShelfOwner = new Map(
        (local.prepare('SELECT id, user_id FROM shelves').all() as any[])
          .map((r) => [String(r.id), String(r.user_id)]));
    }

    let liveRows: any[];
    try {
      liveRows = await fetchLive(spec.name, cols);
    } catch (e: any) {
      errors.push(`${spec.name} fetch: ${e.message.slice(0, 120)}`);
      console.log(`  ✗  ${spec.name}: fetch failed`);
      continue;
    }
    const localRows = local.prepare(`SELECT ${cols.join(',')} FROM ${spec.name}`).all() as any[];

    const liveByPk = new Map(liveRows.map((r) => [key(r, spec.pk), r]));
    const localByPk = new Map(localRows.map((r) => [key(r, spec.pk), r]));
    const liveByNat = spec.naturalKey ? new Map(liveRows.map((r) => [key(r, spec.naturalKey!), r])) : null;
    const localByNat = spec.naturalKey ? new Map(localRows.map((r) => [key(r, spec.naturalKey!), r])) : null;

    const nonPk = cols.filter((c) => !spec.pk.includes(c));
    const insertLocal = local.prepare(
      `INSERT INTO ${spec.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
    const updateLocal = nonPk.length
      ? local.prepare(`UPDATE ${spec.name} SET ${nonPk.map((c) => `${c} = ?`).join(', ')} WHERE ${spec.pk.map((c) => `${c} = ?`).join(' AND ')}`)
      : null;
    const deleteLocal = local.prepare(
      `DELETE FROM ${spec.name} WHERE ${spec.pk.map((c) => `${c} = ?`).join(' AND ')}`);

    let toLocal = 0, toLive = 0, mergedLocal = 0, mergedLive = 0;
    const liveWrites: Array<{ sql: string; args: any[] }> = [];

    // ── live → local ──
    for (const row of liveRows) {
      const pkVal = key(row, spec.pk);
      const localRow = localByPk.get(pkVal);
      if (!localRow) {
        const twin = localByNat?.get(key(row, spec.naturalKey!));
        if (twin) {
          // Natural-key twin under a different id. Newest wins; ADOPT the
          // live row (converge on live's id) when live is same-or-newer.
          const liveU = row.updated_at ?? '';
          const localU = twin.updated_at ?? '';
          if (liveU >= localU) {
            for (const [child, col] of spec.childRefs ?? []) {
              try {
                local.prepare(`UPDATE ${child} SET ${col} = ? WHERE ${col} = ?`).run(row.id, twin.id);
              } catch { /* child table may not exist locally */ }
            }
            deleteLocal.run(...spec.pk.map((c) => twin[c]));
            try { insertLocal.run(...cols.map((c) => row[c])); mergedLocal++; }
            catch (e: any) { errors.push(`${spec.name} adopt: ${e.message.slice(0, 100)}`); }
          }
          // local newer → the live→update path below (push direction) fixes live
          continue;
        }
        try { insertLocal.run(...cols.map((c) => row[c])); toLocal++; }
        catch (e: any) {
          if (!String(e.message).includes('FOREIGN KEY')) errors.push(`${spec.name} insert local: ${e.message.slice(0, 100)}`);
        }
      } else if (spec.hasUpdatedAt && row.updated_at) {
        const localU = localRow.updated_at ?? '';
        if (row.updated_at > localU && updateLocal) {
          updateLocal.run(...nonPk.map((c) => row[c]), ...spec.pk.map((c) => row[c]));
          toLocal++;
        } else if (localU > row.updated_at && pushable(spec, localRow)) {
          // local newer → push local values to live
          liveWrites.push({
            sql: `UPDATE ${spec.name} SET ${nonPk.map((c) => `${c} = ?`).join(', ')} WHERE ${spec.pk.map((c) => `${c} = ?`).join(' AND ')}`,
            args: [...nonPk.map((c) => localRow[c]), ...spec.pk.map((c) => localRow[c])],
          });
          toLive++;
        }
      }
    }

    // ── local → live (rows live doesn't have by PK) ──
    for (const row of localRows) {
      if (liveByPk.has(key(row, spec.pk))) continue;
      if (!pushable(spec, row)) continue; // ghost guard — see header
      const twin = liveByNat?.get(key(row, spec.naturalKey!));
      if (twin) {
        // Live has a natural-key twin under its own id — update it in place
        // when local is strictly newer (live ids are canonical).
        const localU = row.updated_at ?? '';
        const liveU = twin.updated_at ?? '';
        if (localU > liveU) {
          const merged = nonPk.map((c) => (spec.naturalKey!.includes(c) ? twin[c] : row[c]));
          liveWrites.push({
            sql: `UPDATE ${spec.name} SET ${nonPk.map((c) => `${c} = ?`).join(', ')} WHERE ${spec.pk.map((c) => `${c} = ?`).join(' AND ')}`,
            args: [...merged, ...spec.pk.map((c) => twin[c])],
          });
          mergedLive++;
        }
        continue;
      }
      liveWrites.push({
        sql: `INSERT OR IGNORE INTO ${spec.name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
        args: cols.map((c) => row[c]),
      });
      toLive++;
    }

    for (const w of liveWrites) {
      try { await remote.execute({ sql: w.sql, args: w.args }); }
      catch (e: any) {
        totals.errors++;
        errors.push(`${spec.name} live write: ${e.message.slice(0, 100)}`);
      }
    }

    const parts: string[] = [];
    if (toLocal) parts.push(`→local ${toLocal}`);
    if (toLive) parts.push(`→live ${toLive}`);
    if (mergedLocal) parts.push(`merged local ${mergedLocal}`);
    if (mergedLive) parts.push(`merged live ${mergedLive}`);
    console.log(`  ${parts.length ? '✓' : '·'}  ${spec.name.padEnd(34)} ${parts.join(', ') || 'in sync'}`);
    totals.toLocal += toLocal; totals.toLive += toLive;
    totals.mergedLocal += mergedLocal; totals.mergedLive += mergedLive;
  }

  // ── Fresh cover mirror (live → local, last 3 days) ──
  // The app reads LOCAL covers; nightly pull converges them once a day, which
  // left same-day admin fixes/clears and prod-enrichment covers looking stale
  // in the app all day (user report 2026-07-15). This mirrors JUST the cover
  // fields for recently-touched live books every 30 min. Live is authoritative
  // for covers (including clears — cover_source proves intent).
  console.log('\n→ Fresh covers (live → local, 3-day window)');
  try {
    const cutoff = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
    const rows = (await remote.execute({
      sql: `SELECT id, cover_image_url, cover_source, cover_verified, audiobook_cover_url, updated_at
              FROM books WHERE updated_at >= ?`,
      args: [cutoff],
    })).rows as any[];
    const upd = local.prepare(
      `UPDATE books
          SET cover_image_url = ?, cover_source = ?, cover_verified = ?, audiobook_cover_url = ?
        WHERE id = ?
          AND (IFNULL(cover_image_url,'') != IFNULL(?, '')
               OR IFNULL(cover_source,'') != IFNULL(?, '')
               OR IFNULL(audiobook_cover_url,'') != IFNULL(?, ''))
          AND (updated_at IS NULL OR updated_at <= ?)`
    );
    let freshened = 0;
    const trxCovers = local.transaction((rs: any[]) => {
      for (const r of rs) {
        // Never null a local cover from a live NULL unless the clear is
        // intentional (cover_source marker) — protects local enrichment
        // covers awaiting the nightly push.
        const liveCover = r.cover_image_url ?? null;
        const clearedMarkers = ['isbndb-placeholder-cleared', 'gbooks-placeholder-cleared',
                                'openlibrary-placeholder-cleared', 'admin-removed'];
        if (!liveCover && !clearedMarkers.includes(String(r.cover_source))) continue;
        const res = upd.run(
          liveCover, r.cover_source, r.cover_verified, r.audiobook_cover_url,
          r.id, liveCover, r.cover_source, r.audiobook_cover_url, r.updated_at);
        if (res.changes > 0) freshened++;
      }
    });
    trxCovers(rows);
    console.log(`  ${freshened ? '✓' : '·'}  ${freshened} cover(s) freshened (${rows.length} candidates)`);
  } catch (e: any) {
    errors.push(`fresh covers: ${e.message.slice(0, 120)}`);
  }

  // ── up_next: whole-queue mirror per user, newest side wins ──
  console.log('\n→ up_next queues (whole-queue mirror, newest side wins)');
  try {
    const cols = ['id', 'user_id', 'book_id', 'position', 'added_at', 'updated_at'];
    const liveRows = (await remote.execute(`SELECT ${cols.join(',')} FROM up_next`)).rows as any[];
    const localRows = local.prepare(`SELECT ${cols.join(',')} FROM up_next`).all() as any[];
    const byUser = (rows: any[]) => {
      const m = new Map<string, any[]>();
      for (const r of rows) {
        const list = m.get(String(r.user_id)) ?? [];
        list.push(r); m.set(String(r.user_id), list);
      }
      return m;
    };
    const liveBy = byUser(liveRows), localBy = byUser(localRows);
    const maxTs = (rows: any[]) => rows.reduce((m, r) => {
      const t = String(r.updated_at ?? r.added_at ?? '');
      return t > m ? t : m;
    }, '');
    let mirrored = 0;
    for (const [userId, live] of liveBy) {
      const loc = localBy.get(userId) ?? [];
      const liveMax = maxTs(live), localMax = maxTs(loc);
      if (liveMax >= localMax) {
        if (JSON.stringify(live.map((r: any) => [r.book_id, r.position]).sort()) !==
            JSON.stringify(loc.map((r: any) => [r.book_id, r.position]).sort())) {
          local.prepare('DELETE FROM up_next WHERE user_id = ?').run(userId);
          const ins = local.prepare(`INSERT INTO up_next (${cols.join(',')}) VALUES (?,?,?,?,?,?)`);
          for (const r of live) {
            try { ins.run(...cols.map((c) => r[c])); } catch { /* FK: book not local yet */ }
          }
          mirrored++;
        }
      } else if (APP_USERS.has(userId)) {
        await remote.execute({ sql: 'DELETE FROM up_next WHERE user_id = ?', args: [userId] });
        for (const r of loc) {
          await remote.execute({
            sql: `INSERT OR IGNORE INTO up_next (${cols.join(',')}) VALUES (?,?,?,?,?,?)`,
            args: cols.map((c) => r[c]),
          });
        }
        mirrored++;
      }
    }
    // users with a queue ONLY locally → push it (new queue built in the app)
    for (const [userId, loc] of localBy) {
      if (liveBy.has(userId) || !APP_USERS.has(userId)) continue;
      for (const r of loc) {
        await remote.execute({
          sql: `INSERT OR IGNORE INTO up_next (${cols.join(',')}) VALUES (?,?,?,?,?,?)`,
          args: cols.map((c) => r[c]),
        });
      }
      mirrored++;
    }
    console.log(`  ${mirrored ? '✓' : '·'}  ${mirrored} queue(s) mirrored`);
  } catch (e: any) {
    errors.push(`up_next: ${e.message.slice(0, 120)}`);
  }

  // ── Recent book COVERS: newest-wins mirror of the cover fields ──
  // Admin cover fixes happen on BOTH sides now (live web editor + the app's
  // native picker). The books table otherwise rides the nightly sync only,
  // which left same-day fixes invisible on the other side (user report
  // 2026-07-14). Update-only by PK on rows touched in the last 7 days —
  // never inserts, never touches non-cover fields.
  console.log('\n→ recent book covers (newest-wins, last 7 days)');
  try {
    const CUTOFF = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const coverCols = ['cover_image_url', 'cover_source', 'cover_verified', 'audiobook_cover_url'];
    const sel = `SELECT id, ${coverCols.join(',')}, updated_at FROM books WHERE updated_at >= ?`;
    const liveRecent = (await remote.execute({ sql: sel, args: [CUTOFF] })).rows as any[];
    const localRecent = local.prepare(sel).all(CUTOFF) as any[];
    const localById = new Map(localRecent.map((r) => [String(r.id), r]));
    const liveById = new Map(liveRecent.map((r) => [String(r.id), r]));
    const differs = (a: any, b: any) => coverCols.some((c) => (a[c] ?? null) !== (b[c] ?? null));
    const getLocal = local.prepare(`SELECT id, ${coverCols.join(',')}, updated_at FROM books WHERE id = ?`);
    const updLocal = local.prepare(
      `UPDATE books SET ${coverCols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`);
    let coversToLocal = 0, coversToLive = 0;

    // Only rows whose SOURCE side reflects an intentional admin action move.
    // books.updated_at also bumps on enrichment metadata writes, so plain
    // newest-wins could carry a STALE cover over a manual fix; restricting
    // the source to manual/admin-removed scopes this pass to cover edits.
    const adminSet = (r: any) => ['manual', 'admin-removed'].includes(String(r.cover_source));

    for (const lv of liveRecent) {
      if (!adminSet(lv)) continue;
      const loc = (localById.get(String(lv.id)) ?? getLocal.get(lv.id)) as any;
      if (!loc || !differs(lv, loc)) continue;
      if (String(lv.updated_at ?? '') > String(loc.updated_at ?? '')) {
        updLocal.run(...coverCols.map((c) => lv[c]), lv.updated_at, lv.id);
        coversToLocal++;
      }
    }
    for (const loc of localRecent) {
      if (!adminSet(loc)) continue;
      let lv = liveById.get(String(loc.id)) as any;
      if (!lv) {
        const r = await remote.execute({ sql: `SELECT id, ${coverCols.join(',')}, updated_at FROM books WHERE id = ?`, args: [loc.id] });
        lv = r.rows[0];
      }
      if (!lv || !differs(loc, lv)) continue;
      if (String(loc.updated_at ?? '') > String(lv.updated_at ?? '')) {
        await remote.execute({
          sql: `UPDATE books SET ${coverCols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`,
          args: [...coverCols.map((c) => loc[c]), loc.updated_at, loc.id],
        });
        coversToLive++;
      }
    }
    console.log(`  ${coversToLocal + coversToLive ? '✓' : '·'}  covers →local ${coversToLocal}, →live ${coversToLive}`);
    totals.toLocal += coversToLocal; totals.toLive += coversToLive;
  } catch (e: any) {
    errors.push(`book covers: ${e.message.slice(0, 120)}`);
  }

  console.log(`\nDone. →local ${totals.toLocal + totals.mergedLocal}, →live ${totals.toLive + totals.mergedLive}`);
  if (errors.length) {
    console.log(`\n${errors.length} error(s):`);
    for (const e of errors.slice(0, 20)) console.log(`  - ${e}`);
  }
  await escalatePersistentErrors(remote, errors);
  local.close();
  shutdown();
  process.exit(errors.length > 0 && totals.toLocal + totals.toLive + totals.mergedLocal + totals.mergedLive === 0 ? 1 : 0);
})();
