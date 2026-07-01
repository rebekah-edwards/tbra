/**
 * One-off: create auth_refresh_tokens on production Turso (additive, idempotent).
 * Mirrors drizzle/0003_auth_refresh_tokens.sql so the native-auth code can ship
 * safely (new table must land on Turso before the code that uses it deploys).
 */
require('dotenv').config({ path: '.env.vercel.local' });
import { createGuardedTurso } from './lib/turso-guard';

(async () => {
  const { remote } = await createGuardedTurso({
    name: 'apply-auth-refresh-tokens',
    maxRuntimeMs: 2 * 60 * 1000,
    queryTimeoutMs: 30_000,
  });

  const stmts = [
    `CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
      id text PRIMARY KEY NOT NULL,
      user_id text NOT NULL,
      token_hash text NOT NULL,
      expires_at text NOT NULL,
      created_at text DEFAULT (datetime('now')) NOT NULL,
      last_used_at text,
      revoked_at text,
      FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE no action ON DELETE cascade
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS auth_refresh_tokens_hash_unique ON auth_refresh_tokens (token_hash)`,
    `CREATE INDEX IF NOT EXISTS auth_refresh_tokens_user_idx ON auth_refresh_tokens (user_id)`,
  ];

  for (const sql of stmts) {
    await remote.execute(sql);
    console.log('ok:', sql.split('\n')[0].slice(0, 60));
  }

  const check = await remote.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name='auth_refresh_tokens'`,
  );
  console.log('verify table present on Turso:', check.rows.length === 1);
  process.exit(0);
})();
