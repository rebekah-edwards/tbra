/**
 * ONE-OFF 2026-11-25. Skyward (Brandon Sanderson, 1f6ef682) carried the
 * TURKISH edition as its canonical edition (ISBN 9786050979350, Dex Yayinevi,
 * 2020), so enrichment's ISBN lookups pulled a Turkish description. Repoint the
 * row at the English Delacorte first edition and restore the English publisher
 * blurb (OpenLibrary work OL18191919W). Turso first, then local, same stamp.
 * Old values are backed up to reports/backups/. Default dry-run; --apply writes.
 */
require('dotenv').config({ path: '.env.vercel.local' });
import { createGuardedTurso } from './lib/turso-guard';
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const APPLY = process.argv.includes('--apply');
const ID = '1f6ef682-0e23-4846-b336-f4597bb33849';
const DESCRIPTION = [
  "Spensa's world has been under attack for decades.",
  "Now pilots are the heroes of what's left of the human race, and becoming one has always been Spensa's dream. Since she was a little girl, she has imagined soaring skyward and proving her bravery. But her fate is intertwined with her father's—a pilot himself who was killed years ago when he abruptly deserted his team, leaving Spensa the daughter of a coward, her chances of attending Flight School slim to none.",
  "No one will let Spensa forget what her father did, yet fate works in mysterious ways. Flight school might be a long shot, but she is determined to fly. And an accidental discovery in a long-forgotten cavern might just provide her with a way to claim the stars.",
].join('\n\n');

const FIX = {
  description: DESCRIPTION,
  isbn_13: '9780399555770',
  isbn_10: '0399555773',
  publisher: 'Delacorte Press',
  publication_date: '2018-11-06',
  publication_year: 2018,
  pages: 513,
  language: 'English',
  description_stale: 0,
};

(async () => {
  const { remote, shutdown } = await createGuardedTurso({ name: 'tmp-fix-skyward', maxRuntimeMs: 2 * 60 * 1000 });
  const local = new Database(path.join(process.cwd(), 'data', 'tbra.db'));
  const cols = Object.keys(FIX);

  const before = (await remote.execute({ sql: `SELECT ${cols.join(',')}, updated_at FROM books WHERE id=?`, args: [ID] })).rows[0];
  if (!before) throw new Error('Skyward row missing on Turso');
  console.log('BEFORE (turso):', { ...before, description: String(before.description ?? '').slice(0, 80) });

  const clash = (await remote.execute({ sql: `SELECT id, title FROM books WHERE isbn_13=? AND id<>?`, args: [FIX.isbn_13, ID] })).rows;
  if (clash.length) throw new Error(`ISBN ${FIX.isbn_13} already on another row: ${JSON.stringify(clash)}`);

  if (!APPLY) { console.log('DRY RUN — pass --apply'); shutdown(); process.exit(0); }

  const now = new Date().toISOString();
  fs.mkdirSync('reports/backups', { recursive: true });
  fs.writeFileSync('reports/backups/skyward-2026-11-25.json', JSON.stringify({ at: now, id: ID, before }, null, 1));

  const set = cols.map((c) => `${c}=?`).join(', ') + ', updated_at=?';
  const args = [...cols.map((c) => (FIX as any)[c]), now, ID];
  const r = await remote.execute({ sql: `UPDATE books SET ${set} WHERE id=?`, args });
  console.log(`turso rows: ${r.rowsAffected}`);
  const l = local.prepare(`UPDATE books SET ${set} WHERE id=?`).run(...args);
  console.log(`local rows: ${l.changes}`);

  const after = (await remote.execute({ sql: `SELECT isbn_13, publisher, substr(description,1,60) d, updated_at FROM books WHERE id=?`, args: [ID] })).rows[0];
  console.log('AFTER (turso):', after);
  console.log('AFTER (local):', local.prepare(`SELECT isbn_13, publisher, substr(description,1,60) d, updated_at FROM books WHERE id=?`).get(ID));
  shutdown();
  process.exit(0);
})();
