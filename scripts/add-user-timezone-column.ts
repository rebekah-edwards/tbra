/**
 * Adds users.timezone (IANA identifier, nullable) on Turso.
 * Streak days are bucketed in the reader's own zone; UTC bucketing credited
 * evening activity to the next day and broke streaks.
 * Schema must land on Turso BEFORE the code that reads it deploys.
 */
import { createGuardedTurso } from './lib/turso-guard';

(async () => {
  const { remote } = await createGuardedTurso({
    name: 'add-user-timezone-column',
    maxRuntimeMs: 5 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const cols = await remote.execute({ sql: `PRAGMA table_info(users)`, args: [] });
  const has = cols.rows.some((r: Record<string, unknown>) => r.name === 'timezone');
  if (has) {
    console.log('timezone column already present on Turso — nothing to do');
  } else {
    await remote.execute({ sql: `ALTER TABLE users ADD COLUMN timezone TEXT`, args: [] });
    console.log('added users.timezone on Turso');
  }

  const after = await remote.execute({ sql: `PRAGMA table_info(users)`, args: [] });
  console.log('verified:', after.rows.some((r: Record<string, unknown>) => r.name === 'timezone'));
  process.exit(0);
})();
