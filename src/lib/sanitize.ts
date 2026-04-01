/**
 * Safe HTML sanitizer that works in both SSR and client contexts.
 * Uses DOMPurify on the client, strips all tags on the server.
 */

let purify: { sanitize: (html: string, config?: any) => string } | null = null;

if (typeof window !== "undefined") {
  // Client-side: use DOMPurify
  const DOMPurify = require("dompurify");
  purify = DOMPurify.default || DOMPurify;
}

export function sanitizeHtml(html: string, config?: any): string {
  if (purify) {
    return purify.sanitize(html, config);
  }
  // Server-side fallback: strip all HTML tags (safe but lossy)
  return html.replace(/<[^>]*>/g, "");
}
