/**
 * Watchdog exemption helper.
 *
 * The launchd watchdog (scripts/lib/watchdog.sh) SIGKILLs any tbra tsx process
 * older than 60 min UNLESS /tmp/tbra-longrun-<pid> exists. The marker is
 * PER-PID, and `npx tsx` runs the script under a wrapper chain plus esbuild
 * service children — all of which match the watchdog's filter. Marking only
 * process.pid therefore does NOT save the run: the watchdog reaps the wrapper
 * and the child dies with it. So we exempt the whole process tree (ancestors
 * and descendants) and refresh it on a timer, since esbuild children can be
 * respawned mid-run.
 *
 * Extracted 2026-07-29 from the inline copies in description-refresh.ts
 * (2026-07-26) and enrich-content-700.ts (2026-07-29), which were each written
 * after that script was killed mid-run. Those two still carry their own copies;
 * migrate them here when they are next touched.
 *
 * Usage — call once at module top, before any long work:
 *
 *   import { startWatchdogExemption } from "./lib/watchdog-exempt";
 *   const watchdog = startWatchdogExemption();
 *   // ... long-running work ...
 *   watchdog.cleanup();   // optional; also runs on exit/SIGINT/SIGTERM
 */
import fs from "fs";
import { execFileSync } from "child_process";

export interface WatchdogExemption {
  /** Remove every marker this process created and stop refreshing. Idempotent. */
  cleanup: () => void;
  /** Marker paths currently held — exposed for logging/debugging. */
  paths: () => string[];
}

export function startWatchdogExemption(
  refreshMs = 60_000,
): WatchdogExemption {
  const exemptPaths = new Set<string>();

  function markExempt(pid: number) {
    const p = `/tmp/tbra-longrun-${pid}`;
    if (exemptPaths.has(p)) return;
    // The `ps` snapshot below lists the transient `ps` process itself, which
    // has already exited by the time we read it — marking it would leak one
    // stale marker file per refresh. Only mark pids that are still alive.
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    try {
      fs.writeFileSync(p, String(Date.now()));
      exemptPaths.add(p);
    } catch {
      /* non-fatal */
    }
  }

  function refreshExemptions() {
    markExempt(process.pid);
    let table: string;
    try {
      table = execFileSync("ps", ["-Ao", "pid=,ppid="], { encoding: "utf8" });
    } catch {
      return;
    }
    const parent = new Map<number, number>();
    const children = new Map<number, number[]>();
    for (const line of table.split("\n")) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (!pid || !Number.isFinite(ppid)) continue;
      parent.set(pid, ppid);
      if (!children.has(ppid)) children.set(ppid, []);
      children.get(ppid)!.push(pid);
    }
    // Ancestors: the npx/tsx wrapper chain. Bounded at 5 so we never walk up
    // into launchd itself.
    let cur = parent.get(process.pid);
    for (let i = 0; i < 5 && cur && cur > 1; i++) {
      markExempt(cur);
      cur = parent.get(cur);
    }
    // Descendants: esbuild service children, and anything they spawn.
    const queue = [...(children.get(process.pid) ?? [])];
    while (queue.length) {
      const pid = queue.shift()!;
      markExempt(pid);
      queue.push(...(children.get(pid) ?? []));
    }
  }

  refreshExemptions();
  const timer = setInterval(refreshExemptions, refreshMs);
  timer.unref();

  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    clearInterval(timer);
    for (const p of exemptPaths) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    exemptPaths.clear();
  }

  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  return { cleanup, paths: () => [...exemptPaths] };
}
