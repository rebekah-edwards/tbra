/** ONE-OFF 2026-11-25: hand touch-ups after fix-non-english-descriptions (Midnight Sun English publisher copy; ADSOM stray OL attribution). Turso then local. */
require("dotenv").config({ path: ".env.vercel.local" });
import { createGuardedTurso } from "./lib/turso-guard";
const Database = require("better-sqlite3");
const MS = "#1 bestselling author Stephenie Meyer makes a triumphant return to the world of Twilight with this highly anticipated companion: the iconic love story of Bella and Edward told from the vampire's point of view.\n\nWhen Edward Cullen and Bella Swan met in Twilight, an iconic love story was born. But until now, fans have heard only Bella's side of the story. At last, readers can experience Edward's version in the long-awaited companion novel, Midnight Sun. This unforgettable tale as told through Edward's eyes takes on a new and decidedly dark twist. Meeting Bella is both the most unnerving and intriguing event he has experienced in all his years as a vampire.";
(async () => {
  const { remote, shutdown } = await createGuardedTurso({ name: "tmp-desc-touchups", maxRuntimeMs: 60_000 });
  const local = new Database("data/tbra.db");
  const now = new Date().toISOString();
  const adsom = String((await remote.execute({ sql: "SELECT description FROM books WHERE id=?", args: ["6eb0067d-a7d7-4ebb-8c10-cf5fb9869229"] })).rows[0].description).replace(/\n*This description comes from the publisher\.\s*/g, "\n\n").trim();
  for (const [id, d] of [["c98dcd33-4637-4b9a-8fed-cd5ad7c1f707", MS], ["6eb0067d-a7d7-4ebb-8c10-cf5fb9869229", adsom]]) {
    const r = await remote.execute({ sql: "UPDATE books SET description=?, description_stale=0, updated_at=? WHERE id=?", args: [d, now, id] });
    const l = local.prepare("UPDATE books SET description=?, description_stale=0, updated_at=? WHERE id=?").run(d, now, id);
    console.log(id, "turso", r.rowsAffected, "local", l.changes);
  }
  shutdown(); process.exit(0);
})();
