import { isLocalInstance, isSyncableUser } from '@/lib/sync/app-users';

/**
 * Blocks CSV imports that would strand a real user's library on this Mac.
 *
 * THE FAILURE (2026-07-30 myerschar9, 2026-08-08 joannajerowsky):
 * The dev server on this Mac serves the same /import page as production, but it
 * writes to local sqlite. `sync-user-activity.ts` only pushes rows owned by
 * SYNCABLE_USER_IDS, so a CSV imported here for anyone else can NEVER reach
 * production. The tester is left staring at an empty library on
 * thebasedreader.app while their books sit in a database they cannot see —
 * myerschar9 for 11 days, joannajerowsky for over three months.
 *
 * `scripts/run-goodreads-import.ts` was given a mandatory --target flag on
 * 2026-07-30 to close the CLI door. This closes the other one: the import page
 * itself. Both doors led to the same place.
 *
 * WHAT IS STILL ALLOWED, deliberately:
 *  - Every import on the deployed app (the normal path — this is a no-op there).
 *  - Local imports for accounts sync-user-activity actually pushes, so Rebekah
 *    and the test account can still exercise the flow end to end.
 *  - Anything, with ALLOW_LOCAL_IMPORT=1 set, for a deliberate supervised run.
 *    Pair it with the PUSH_USERS backfill recipe or the data stays stranded.
 *
 * Returns a Response to return immediately, or null to proceed.
 */
export function guardLocalImport(userId: string | null | undefined): Response | null {
  if (!isLocalInstance()) return null;
  if (process.env.ALLOW_LOCAL_IMPORT === '1') return null;
  if (isSyncableUser(userId)) return null;

  return new Response(
    JSON.stringify({
      error:
        'This is the local development server — an import here would save to this Mac only, ' +
        'and would never reach thebasedreader.app. Import from the live site instead. ' +
        '(Deliberate local run: set ALLOW_LOCAL_IMPORT=1, then push with the PUSH_USERS recipe ' +
        'in scripts/sync-user-activity.ts.)',
    }),
    { status: 403, headers: { 'Content-Type': 'application/json' } },
  );
}
