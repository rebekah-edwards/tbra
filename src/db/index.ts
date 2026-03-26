import * as schema from "./schema";

const isTurso = !!process.env.TURSO_DATABASE_URL;

let db: ReturnType<typeof createDb>;
let sqlite: unknown = null;

function createDb() {
  if (isTurso) {
    // Production: use Turso (hosted libSQL)
    const { createClient } = require("@libsql/client");
    const { drizzle } = require("drizzle-orm/libsql");

    const client = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });

    return drizzle(client, { schema });
  } else {
    // Local development: use better-sqlite3
    const Database = require("better-sqlite3");
    const { drizzle } = require("drizzle-orm/better-sqlite3");
    const path = require("path");

    const dbPath = path.join(process.cwd(), "data", "tbra.db");
    const sqliteDb = new Database(dbPath);
    sqliteDb.pragma("journal_mode = WAL");
    sqliteDb.pragma("foreign_keys = ON");
    sqliteDb.pragma("busy_timeout = 5000");

    sqlite = sqliteDb;
    return drizzle(sqliteDb, { schema });
  }
}

db = createDb();

export { db, sqlite };
