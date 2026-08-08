/**
 * turso-guard.ts — mandatory wrapper for any script that writes to production Turso.
 *
 * Provides three guarantees that together make "script hangs for hours while
 * saturating Turso and degrading the live site" structurally impossible:
 *
 *   1. Per-query timeout. Every `remote.execute(...)` is raced against a
 *      timeout (default 30s). A hung single query rejects instead of
 *      blocking forever.
 *   2. Wall-clock self-abort. Script declares its own ceiling (e.g. 10min,
 *      1h, 6h). If exceeded, the guard logs the elapsed time and exits
 *      with code 2 so the caller/cron sees the failure.
 *   3. PID lockfile. Refuses to run if another PID holds the same lockfile
 *      name. Prevents parallel copies of a nightly job stacking on top of
 *      each other (the 2026-04-20 postmortem pattern).
 *
 * The watchdog at scripts/lib/watchdog.sh is an independent backstop that
 * fires if this wrapper is not used or its timeout is misconfigured. The
 * wrapper is the primary defense; the watchdog is the floor.
 *
 * Usage (minimal):
 *
 *   import { createGuardedTurso } from './lib/turso-guard';
 *   const { remote, heartbeat } = await createGuardedTurso({
 *     name: 'push-content-ratings',
 *     maxRuntimeMs: 20 * 60 * 1000,   // 20 min ceiling
 *     queryTimeoutMs: 30_000,          // 30s per query
 *   });
 *   // …use `remote.execute(...)` just like an @libsql/client. Call
 *   //    heartbeat() periodically to show you're still making progress
 *   //    (doesn't extend the ceiling; purely for log readability).
 */

import * as fs from "fs";
import * as path from "path";
import { createClient, Client, ResultSet } from "@libsql/client";
import { startWatchdogExemption } from "./watchdog-exempt";

export interface GuardOptions {
  /** Lockfile suffix + identifier printed in logs. Use the script's base name. */
  name: string;
  /** Hard ceiling on total script runtime. Process exits with code 2 if exceeded. */
  maxRuntimeMs: number;
  /** Per-query timeout. Default 30s. */
  queryTimeoutMs?: number;
  /** Longer than 30min? Set to true. Touches /tmp/tbra-longrun-<pid> so the
   *  watchdog doesn't kill you. The wrapper's own wall-clock is still authoritative. */
  longRunning?: boolean;
}

export interface GuardedTurso {
  /** Drop-in replacement for a libsql Client — `remote.execute(...)` is query-timed. */
  remote: Client;
  /** Call this between steps to refresh the lockfile mtime (for debugging only). */
  heartbeat: (note?: string) => void;
  /** Explicit shutdown if you want to close before the process exits. */
  shutdown: () => void;
}

export async function createGuardedTurso(opts: GuardOptions): Promise<GuardedTurso> {
  const {
    name,
    maxRuntimeMs,
    queryTimeoutMs = 30_000,
    longRunning = false,
  } = opts;

  if (!name || !/^[a-z0-9-]+$/.test(name)) {
    throw new Error(`turso-guard: invalid name "${name}" (lowercase + dashes only)`);
  }
  if (!Number.isFinite(maxRuntimeMs) || maxRuntimeMs <= 0) {
    throw new Error(`turso-guard: maxRuntimeMs must be positive`);
  }

  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url || !authToken) {
    throw new Error(
      `turso-guard: TURSO_DATABASE_URL / TURSO_AUTH_TOKEN missing. Run \`npx vercel env pull\` or source .env.vercel.local.`,
    );
  }

  const lockPath = `/tmp/tbra-${name}.lock`;
  // Watchdog exemption is delegated to startWatchdogExemption(), which covers
  // the WHOLE process tree. This used to mark only pid + ppid, which is not
  // enough: measured 2026-08-08 against the watchdog's own filter, a
  // `npx tsx` run under a nightly task exposes FIVE matching pids —
  //
  //   zsh -c "cd …/tbra && … npx tsx …"   ← matches (path + "tsx" in cmdline)
  //   npm exec tsx …                       ← does NOT match (no tbra path)
  //   node …/node_modules/.bin/tsx …       ← matches   (was ppid)
  //   node --require …/tsx/preflight.cjs   ← matches   (was process.pid)
  //   2× esbuild --service=…               ← matches, and can RESPAWN mid-run
  //
  // pid + ppid left the invoking shell exposed — and in a nightly task that
  // shell is running `cd tbra && <script> && sync-incremental.sh push`, so
  // reaping it kills the chained push too — plus the esbuild children, which
  // a one-shot marker cannot cover because they respawn. The helper walks
  // ancestors and descendants and refreshes on a timer.
  let watchdogExemption: { cleanup: () => void } | null = null;

  // ── PID lockfile ──────────────────────────────────────────────────────
  try {
    const existing = fs.readFileSync(lockPath, "utf8").trim();
    const pid = parseInt(existing, 10);
    if (Number.isFinite(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        console.error(
          `turso-guard[${name}]: already running (PID ${pid}). Remove ${lockPath} to override.`,
        );
        process.exit(2);
      } catch {
        console.log(`turso-guard[${name}]: stale lockfile (PID ${pid} gone). Taking over.`);
      }
    }
  } catch {
    /* no lockfile */
  }
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, String(process.pid));

  if (longRunning) {
    watchdogExemption = startWatchdogExemption();
  }

  // ── Wall-clock self-abort ─────────────────────────────────────────────
  const startedAt = Date.now();
  // The deadline timer is unref'd so it does NOT keep the event loop alive
  // after the script's main() returns naturally. (Earlier comment claimed
  // "cleanup() clears it on natural exit, so well-behaved scripts won't be
  // held open" — this was wrong: cleanup is only registered on the "exit"
  // event, which fires AFTER process.exit, but the process can't exit
  // because the timer is keeping it alive. Chicken-and-egg.)
  //
  // unref'd timers still fire on schedule when reached — they just don't
  // count as a reason to keep the process alive. So a truly-hung script
  // with other open handles (the libsql client) will still get killed at
  // the deadline; a well-behaved script that finishes its work will exit
  // cleanly via beforeExit/exit hooks below. (Bug introduced 2026-04-22,
  // root cause of 2026-05-05 outage.)
  const deadline = setTimeout(() => {
    const elapsedMin = ((Date.now() - startedAt) / 60_000).toFixed(1);
    console.error(
      `turso-guard[${name}]: WALL-CLOCK ABORT after ${elapsedMin}min ` +
        `(ceiling ${Math.round(maxRuntimeMs / 60_000)}min). Exiting.`,
    );
    cleanup();
    process.exit(2);
  }, maxRuntimeMs);
  deadline.unref();

  // ── Cleanup on any exit path ──────────────────────────────────────────
  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    clearTimeout(deadline);
    try { inner.close(); } catch { /* libsql client may already be closed */ }
    try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
    try { watchdogExemption?.cleanup(); } catch { /* ignore */ }
  };
  // beforeExit fires when the event loop is empty (no pending tasks,
  // no other handles). At that point we know the script's work is done
  // and we can safely close the libsql client and clean up. This is the
  // hook that catches scripts which call main() and then return without
  // an explicit process.exit() — they used to hang here.
  process.on("beforeExit", () => { cleanup(); });
  process.on("exit", cleanup);
  process.on("SIGINT",  () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });
  process.on("uncaughtException", (e: Error) => {
    console.error(`turso-guard[${name}]: uncaught`, e);
    cleanup();
    process.exit(1);
  });

  // ── Per-query timeout wrapper ─────────────────────────────────────────
  const inner = createClient({ url, authToken });

  const withTimeout = async <T>(
    promise: Promise<T>,
    label: string,
  ): Promise<T> => {
    let timer: NodeJS.Timeout | null = null;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `turso-guard[${name}]: query timeout (${queryTimeoutMs}ms) — ${label}`,
          ),
        );
      }, queryTimeoutMs);
      timer.unref();
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const labelFor = (stmtOrSql: unknown): string => {
    if (typeof stmtOrSql === "string") {
      return stmtOrSql.slice(0, 60).replace(/\s+/g, " ");
    }
    if (stmtOrSql && typeof stmtOrSql === "object" && "sql" in stmtOrSql) {
      const sql = (stmtOrSql as { sql: unknown }).sql;
      if (typeof sql === "string") return sql.slice(0, 60).replace(/\s+/g, " ");
    }
    return "(unknown stmt)";
  };

  // Forward all arguments to the underlying execute — libsql supports both
  // execute(stmt) and execute(sql, args) overloads.
  const guarded: Client = new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "execute") {
        return (...args: unknown[]): Promise<ResultSet> => {
          const label = labelFor(args[0]);
          return withTimeout(
            (target.execute as (...a: unknown[]) => Promise<ResultSet>)(...args),
            label,
          );
        };
      }
      if (prop === "batch") {
        return (...args: unknown[]): Promise<ResultSet[]> => {
          const stmts = args[0] as unknown[];
          const len = Array.isArray(stmts) ? stmts.length : 0;
          return withTimeout(
            (target.batch as (...a: unknown[]) => Promise<ResultSet[]>)(...args),
            `batch(${len})`,
          );
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  const heartbeat = (note?: string) => {
    try {
      fs.utimesSync(lockPath, new Date(), new Date());
      if (note) console.log(`turso-guard[${name}] ❤ ${note}`);
    } catch { /* ignore */ }
  };

  const shutdown = () => cleanup();

  console.log(
    `turso-guard[${name}]: ready (pid=${process.pid}, ` +
      `ceiling=${Math.round(maxRuntimeMs / 60_000)}min, ` +
      `queryTimeout=${queryTimeoutMs}ms, ` +
      `longRunning=${longRunning})`,
  );

  return { remote: guarded, heartbeat, shutdown };
}
