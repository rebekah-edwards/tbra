/**
 * The accounts whose LOCAL rows are allowed to reach production.
 *
 * `scripts/sync-user-activity.ts` pushes local user rows →live only for these
 * ids (its `pushable()` ghost-resurrection guard). Everyone else's local rows
 * are permanently stranded on this Mac — which is the whole failure documented
 * in memory `project_tester_libraries_stuck_local`: myerschar9 sat with a
 * 1,169-book library here and an empty library on thebasedreader.app for 11
 * days, and joannajerowsky for over three months.
 *
 * Kept here, in app code rather than in a script, so the import guard and the
 * sync scripts cannot drift apart on who is pushable — the drift is what makes
 * the failure invisible.
 */
export const SYNCABLE_USER_IDS: ReadonlySet<string> = new Set([
  'c2f3eb27-139f-4605-9566-8ded8d9e1336', // rebekah_creates
  '012605dd-177d-48c6-9717-490e7ef05b30', // clanker_test
]);

export function isSyncableUser(userId: string | null | undefined): boolean {
  return !!userId && SYNCABLE_USER_IDS.has(userId);
}

/**
 * True when this process is the local dev server on Rebekah's Mac rather than
 * the deployed app. Vercel sets VERCEL=1 in every deployment environment.
 */
export function isLocalInstance(): boolean {
  return !process.env.VERCEL;
}
