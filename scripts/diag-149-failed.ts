require("dotenv").config({ path: ".env.vercel.local" });
const { createClient } = require("@libsql/client");
const Database = require("better-sqlite3");
const path = require("path");

const remote = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const local = new Database(path.join(process.cwd(), "data", "tbra.db"), { readonly: true });

(async () => {
  const sample = [
    "223ccd4e-448d-4260-8a3f-5ceadd89dcea",
    "223d6e36-3a18-4870-9e06-d1333cfe9ea4",
    "223e13d8-fd0c-4736-a57c-b4862cc75f59",
    "223ecf5f-bb9f-4aad-bea1-5f8c0fa1d27e",
    "2241db33-647e-4777-a076-edc3cc07ade0",
  ];

  for (const id of sample) {
    const localBook = local
      .prepare(`SELECT id, slug, isbn_13, open_library_key FROM books WHERE id = ?`)
      .get(id) as any;
    console.log(`\nLocal: ${id} slug=${localBook?.slug} isbn=${localBook?.isbn_13} ol=${localBook?.open_library_key}`);

    const byId = await remote.execute(`SELECT id FROM books WHERE id = ?`, [id]);
    console.log(`  remote by id: ${byId.rows.length > 0 ? "FOUND" : "MISSING"}`);

    if (localBook?.slug) {
      const bySlug = await remote.execute(`SELECT id FROM books WHERE slug = ?`, [localBook.slug]);
      console.log(`  remote by slug: ${bySlug.rows.length > 0 ? `FOUND id=${bySlug.rows[0].id}` : "MISSING"}`);
    }
    if (localBook?.isbn_13) {
      const byIsbn = await remote.execute(`SELECT id FROM books WHERE isbn_13 = ?`, [localBook.isbn_13]);
      console.log(`  remote by isbn_13: ${byIsbn.rows.length > 0 ? `FOUND id=${byIsbn.rows[0].id}` : "MISSING"}`);
    }
    if (localBook?.open_library_key) {
      const byOl = await remote.execute(`SELECT id FROM books WHERE open_library_key = ?`, [
        localBook.open_library_key,
      ]);
      console.log(`  remote by ol_key: ${byOl.rows.length > 0 ? `FOUND id=${byOl.rows[0].id}` : "MISSING"}`);
    }
  }

  local.close();
})();
