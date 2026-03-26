"use client";

import { useState } from "react";
import DOMPurify from "isomorphic-dompurify";

interface BookDescriptionProps {
  description: string | null;
}

function renderMarkdown(text: string): string {
  // Extract reference-style link definitions: [1]: http://...
  const refLinks: Record<string, string> = {};
  let cleaned = text.replace(
    /^\[([^\]]+)\]:\s*(.+)$/gm,
    (_match, key: string, url: string) => {
      refLinks[key] = url.trim();
      return "";
    }
  );

  return cleaned
    // Escape HTML entities
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Inline links: [text](url) — validate protocol
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) => {
      const safeUrl = /^https?:\/\//i.test(url) ? url : '#';
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-dark underline">${text}</a>`;
    })
    // Reference-style links: [text][1] or ([text][1]) — validate protocol
    .replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (_match, linkText: string, ref: string) => {
      const url = refLinks[ref];
      if (url) {
        const safeUrl = /^https?:\/\//i.test(url) ? url : '#';
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-dark underline">${linkText}</a>`;
      }
      return linkText;
    })
    // Bold: **text** or __text__
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    // Italic: *text* or _text_
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>")
    // Line breaks: double newline → paragraph break, single → <br>
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, '</p><p class="mt-3">')
    .replace(/\n/g, "<br>");
}

export function BookDescription({ description }: BookDescriptionProps) {
  const [expanded, setExpanded] = useState(false);

  if (!description) return null;

  const isLong = description.length > 500;
  const displayText =
    isLong && !expanded ? description.slice(0, 500) + "..." : description;

  const html = renderMarkdown(displayText);

  return (
    <section className="mt-8">
      <h2 className="section-heading text-xl">About</h2>
      <div
        className="mt-2 text-sm leading-relaxed text-muted"
        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(`<p>${html}</p>`) }}
      />
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-sm font-semibold read-more-link"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </section>
  );
}
