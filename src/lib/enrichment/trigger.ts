/**
 * Fire a request to the /api/enrichment/trigger endpoint.
 *
 * This spawns an independent serverless invocation on Vercel that
 * awaits enrichBook() to completion. Designed to be called from
 * next/server `after()` callbacks or directly — the fetch itself
 * is fire-and-forget but the *target* endpoint runs to completion.
 */
export function triggerEnrichment(bookId: string): void {
  const vercelUrl = process.env.VERCEL_URL;
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;

  let baseUrl: string;
  if (appUrl) {
    baseUrl = appUrl;
  } else if (vercelUrl) {
    baseUrl = vercelUrl.startsWith("http") ? vercelUrl : `https://${vercelUrl}`;
  } else {
    baseUrl = "http://localhost:3000";
  }

  const url = `${baseUrl}/api/enrichment/trigger`;

  fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-enrichment-secret": process.env.ENRICHMENT_SECRET || "",
    },
    body: JSON.stringify({ bookId }),
  }).catch((err) => {
    console.error(`[trigger-enrichment] Failed to call trigger endpoint for ${bookId}:`, err);
  });
}
