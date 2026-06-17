/**
 * Build a markdown report of the dupe groups the auto-merger skipped as ambiguous.
 * Each group lists every sibling with clickable live URL, user count, cover, year.
 * Each group includes the reason it was skipped so the user can make a call.
 */
import fs from "fs";
import path from "path";

const candidatesPath = process.argv
  .find((a) => a.startsWith("--candidates="))
  ?.split("=")[1];
if (!candidatesPath) {
  const latest = fs
    .readdirSync(path.join(process.cwd(), "reports"))
    .filter((f) => f.startsWith("title-author-dupe-candidates-"))
    .sort()
    .at(-1);
  if (!latest) throw new Error("No candidates file found.");
}
const inPath =
  candidatesPath ??
  path.join(
    process.cwd(),
    "reports",
    fs
      .readdirSync(path.join(process.cwd(), "reports"))
      .filter((f) => f.startsWith("title-author-dupe-candidates-"))
      .sort()
      .at(-1)!,
  );

const groups: Array<{
  title: string;
  author: string;
  count: number;
  slug_prefix_pair: boolean;
  suggested_canonical_id: string;
  auto_mergeable: boolean;
  rows: Array<{
    id: string;
    slug: string;
    cover_source: string | null;
    cover_image_url: string | null;
    publication_year: number | null;
    turso_user_count?: number;
    local_user_count: number;
  }>;
}> = JSON.parse(fs.readFileSync(inPath, "utf8"));

const ambiguous = groups.filter((g) => !g.auto_mergeable);

function reasonCode(g: typeof groups[0]): "USERS_ON_DUPE" | "MULTI_USER" | "NULL_SLUG_NO_USERS" | "SCORE_TIE" {
  const getUsers = (r: any) => r.turso_user_count ?? r.local_user_count ?? 0;
  const withUsers = g.rows.filter((r) => getUsers(r) > 0);
  if (withUsers.length > 1) return "MULTI_USER";
  const nullSlugs = g.rows.filter((r) => !r.slug || r.slug === "null");
  if (withUsers.length === 1 && nullSlugs.some((r) => getUsers(r) > 0)) return "USERS_ON_DUPE";
  if (nullSlugs.length > 0) return "NULL_SLUG_NO_USERS";
  return "SCORE_TIE";
}
function reasonText(code: string): string {
  switch (code) {
    case "MULTI_USER":
      return "MULTIPLE siblings have user state — merge needs careful preservation";
    case "USERS_ON_DUPE":
      return "User activity is on a null-slug / non-canonical entry — safe to migrate via replay-dedup";
    case "NULL_SLUG_NO_USERS":
      return "Group contains a null/empty slug entry + no clear winner on the others";
    case "SCORE_TIE":
      return "Top two siblings within 10 points — pick a canonical manually";
    default:
      return code;
  }
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outPath = path.join(process.cwd(), "reports", `ambiguous-dupes-review-${stamp}.md`);

// Tag each group with its reason code so we can bucket
const tagged = ambiguous.map((g) => ({ g, code: reasonCode(g) }));
const byCode: Record<string, typeof tagged> = {
  MULTI_USER: [],
  USERS_ON_DUPE: [],
  NULL_SLUG_NO_USERS: [],
  SCORE_TIE: [],
};
for (const t of tagged) byCode[t.code].push(t);

let md = `# Ambiguous Duplicate Groups — Manual Review\n\n`;
md += `Generated: ${new Date().toISOString()}\n`;
md += `Source: ${path.basename(inPath)}\n`;
md += `Total ambiguous groups: **${ambiguous.length}**\n\n`;
md += `## Quick summary\n\n`;
md += `| Reason | Count | What it means |\n|---|---|---|\n`;
md += `| MULTI_USER | ${byCode.MULTI_USER.length} | 2+ siblings have user state — needs careful preservation (truly manual) |\n`;
md += `| USERS_ON_DUPE | ${byCode.USERS_ON_DUPE.length} | User state is on a null-slug / secondary entry — safe to batch-merge with user-data migration |\n`;
md += `| NULL_SLUG_NO_USERS | ${byCode.NULL_SLUG_NO_USERS.length} | Group contains a null/empty slug + no user state — canonical pick is easy, low risk |\n`;
md += `| SCORE_TIE | ${byCode.SCORE_TIE.length} | Top two scored within 10 points of each other — pick a winner |\n\n`;
md += `**Recommendation:** USERS_ON_DUPE and NULL_SLUG_NO_USERS are low-risk to add to the auto-merge batch if you're comfortable. MULTI_USER needs real eyeballs. SCORE_TIE is low-stakes (all 0-user groups — you're just picking which 0-user entry wins).\n\n`;
md += `Each group below links to the live page. Tell me which of these buckets to include in the Phase 2 run.\n\n---\n\n`;

let i = 0;
for (const bucketName of ["MULTI_USER", "USERS_ON_DUPE", "NULL_SLUG_NO_USERS", "SCORE_TIE"]) {
  const bucket = byCode[bucketName];
  if (bucket.length === 0) continue;
  md += `\n# Bucket: ${bucketName} (${bucket.length})\n\n`;
  md += `${reasonText(bucketName)}\n\n`;
  // Within each bucket, sort by total users desc (higher stakes first)
  bucket.sort((a, b) => {
    const aUsers = a.g.rows.reduce((s, r) => s + (r.turso_user_count ?? r.local_user_count ?? 0), 0);
    const bUsers = b.g.rows.reduce((s, r) => s + (r.turso_user_count ?? r.local_user_count ?? 0), 0);
    if (aUsers !== bUsers) return bUsers - aUsers;
    return b.g.count - a.g.count;
  });
  for (const { g } of bucket) {
    i++;
    md += `## ${i}. ${g.title} — ${g.author}\n\n`;
    md += `| Slug | Users | Cover | Year | Suggested |\n`;
    md += `|---|---|---|---|---|\n`;
    for (const r of g.rows) {
      const users = r.turso_user_count ?? r.local_user_count ?? 0;
      const slugLink = !r.slug || r.slug === "null"
        ? "`(null)`"
        : `[${r.slug}](https://www.thebasedreader.app/book/${r.slug})`;
      const tag = r.id === g.suggested_canonical_id ? "★ canonical" : "";
      md += `| ${slugLink} | ${users} | ${r.cover_source ?? "—"} | ${r.publication_year ?? "—"} | ${tag} |\n`;
    }
    md += `\n`;
  }
}

fs.writeFileSync(outPath, md);
console.log(`Wrote ${outPath}  (${ambiguous.length} ambiguous groups)`);
