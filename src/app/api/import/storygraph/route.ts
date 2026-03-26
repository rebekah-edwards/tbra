import { getCurrentUser } from "@/lib/auth";
import { parseStoryGraphCSV } from "@/lib/import/parse-storygraph";
import { importStoryGraphRows } from "@/lib/import/import-storygraph";
import { parseImportOptions } from "@/lib/import/import-options";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes (Vercel hobby plan limit)

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return new Response(JSON.stringify({ error: "No file uploaded" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!file.name.endsWith(".csv")) {
    return new Response(JSON.stringify({ error: "File must be a CSV" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const options = parseImportOptions(formData);
  const csvText = await file.text();
  const rows = parseStoryGraphCSV(csvText);

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ error: "No valid rows found in CSV. Make sure it is a StoryGraph export." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Stream progress events as newline-delimited JSON
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of importStoryGraphRows(rows, user.userId, options)) {
          const line = JSON.stringify(event) + "\n";
          controller.enqueue(encoder.encode(line));
        }
      } catch (err) {
        const errorEvent = {
          type: "error",
          message: err instanceof Error ? err.message : "Import failed",
        };
        controller.enqueue(encoder.encode(JSON.stringify(errorEvent) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-cache",
    },
  });
}
