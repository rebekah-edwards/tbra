import { getCurrentUser } from "@/lib/auth";
import { parseGoodreadsCSV } from "@/lib/import/parse-goodreads";
import { importGoodreadsRows } from "@/lib/import/import-goodreads";
import { parseImportOptions } from "@/lib/import/import-options";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return new Response("Unauthorized", { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";

  // ── Batch mode: JSON body with pre-parsed rows + offset ──
  if (contentType.includes("application/json")) {
    const body = await request.json();
    const { rows, offset = 0, total, options: optionsRaw } = body as {
      rows: ReturnType<typeof parseGoodreadsCSV>;
      offset: number;
      total: number;
      options: Record<string, unknown>;
    };

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return new Response(JSON.stringify({ error: "No rows provided" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const options = {
      updateReadingStates: optionsRaw?.updateReadingStates !== false,
      updateRatingsReviews: optionsRaw?.updateRatingsReviews !== false,
      updateOwnedFormats: optionsRaw?.updateOwnedFormats !== false,
      isReimport: !!optionsRaw?.isReimport,
    };

    // Stream progress for this batch
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of importGoodreadsRows(rows, user.userId, options)) {
            if (event.type === "progress") {
              // Adjust current to reflect global offset
              const adjusted = { ...event, current: event.current + offset, total };
              controller.enqueue(encoder.encode(JSON.stringify(adjusted) + "\n"));
            } else {
              // Done event — pass through with adjusted counts
              controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
            }
          }
        } catch (err) {
          controller.enqueue(encoder.encode(JSON.stringify({
            type: "error",
            message: err instanceof Error ? err.message : "Import failed",
          }) + "\n"));
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

  // ── Legacy mode: FormData with CSV file (still supported) ──
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
  const rows = parseGoodreadsCSV(csvText);

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ error: "No valid rows found in CSV. Make sure it is a Goodreads export." }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of importGoodreadsRows(rows, user.userId, options)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        controller.enqueue(encoder.encode(JSON.stringify({
          type: "error",
          message: err instanceof Error ? err.message : "Import failed",
        }) + "\n"));
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
