"use client";

import { useState } from "react";

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
    // Inline links: [text](url)
    .replace(
      /\[([^\]]+)\]\(([^)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-dark underline">$1</a>'
    )
    // Reference-style links: [text][1] or ([text][1])
    .replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (_match, linkText: string, ref: string) => {
      const url = refLinks[ref];
      if (url) {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-dark underline">${linkText}</a>`;
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

  const isLong = description.length > 300;
  const displayText =
    isLong && !expanded ? description.slice(0, 300) + "..." : description;

  const html = renderMarkdown(displayText);

  return (
    <section className="mt-8">
      <h2 className="text-xl font-bold uppercase tracking-wide text-neon-blue">About</h2>
      <div
        className="mt-2 text-sm leading-relaxed text-muted"
        dangerouslySetInnerHTML={{ __html: `<p>${html}</p>` }}
      />
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-sm text-primary hover:text-primary-dark"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </section>
  );
}
