import { getCurrentUser } from "@/lib/auth";
import { parseGoodreadsCSV } from "@/lib/import/parse-goodreads";

export const runtime = "nodejs";

/**
 * Parse a Goodreads CSV and return the rows as JSON.
 * Client uses this to get parsed rows, then sends them in batches to the main import endpoint.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file || !file.name.endsWith(".csv")) {
    return new Response(JSON.stringify({ error: "Please upload a valid CSV file" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const csvText = await file.text();
  const rows = parseGoodreadsCSV(csvText);

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ error: "No valid rows found. Make sure this is a Goodreads export." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(JSON.stringify({ rows, total: rows.length }), {
    headers: { "Content-Type": "application/json" },
  });
}
