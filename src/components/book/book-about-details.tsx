"use client";

import { useState } from "react";
import DOMPurify from "isomorphic-dompurify";

interface BookAboutDetailsProps {
  description: string | null;
  publicationDate: string | null;
  publicationYear: number | null;
  pages: number | null;
  language: string | null;
  publisher: string | null;
  isbn13: string | null;
  isbn10: string | null;
  asin: string | null;
  isFiction: boolean | null;
  audioLengthMinutes: number | null;
  seriesName: string | null;
  seriesPosition: number | null;
}

type Tab = "about" | "details";

function renderMarkdown(text: string): string {
  const refLinks: Record<string, string> = {};
  let cleaned = text.replace(
    /^\[([^\]]+)\]:\s*(.+)$/gm,
    (_match, key: string, url: string) => {
      refLinks[key] = url.trim();
      return "";
    }
  );

  return cleaned
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, text: string, url: string) => {
      const safeUrl = /^https?:\/\//i.test(url) ? url : '#';
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-dark underline">${text}</a>`;
    })
    .replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (_match, linkText: string, ref: string) => {
      const url = refLinks[ref];
      if (url) {
        const safeUrl = /^https?:\/\//i.test(url) ? url : '#';
        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-dark underline">${linkText}</a>`;
      }
      return linkText;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__(.+?)__/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, "<em>$1</em>")
    .replace(/\r\n/g, "\n")
    .replace(/\n{2,}/g, '</p><p class="mt-3">')
    .replace(/\n/g, "<br>");
}

function formatReleaseDate(publicationDate: string | null, publicationYear: number | null): string | null {
  if (publicationDate) {
    // Could be "2026-04-01" or "2025-12"
    const parts = publicationDate.split("-");
    if (parts.length === 3) {
      const date = new Date(publicationDate + "T00:00:00");
      return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    }
    if (parts.length === 2) {
      const date = new Date(publicationDate + "-01T00:00:00");
      return date.toLocaleDateString("en-US", { year: "numeric", month: "long" });
    }
  }
  if (publicationYear) return String(publicationYear);
  return null;
}

function formatAudioLength(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

export function BookAboutDetails({
  description,
  publicationDate,
  publicationYear,
  pages,
  language,
  publisher,
  isbn13,
  isbn10,
  asin,
  isFiction,
  audioLengthMinutes,
  seriesName,
  seriesPosition,
}: BookAboutDetailsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("about");
  const [expanded, setExpanded] = useState(false);

  // Build details rows — only show non-null values
  const details: { label: string; value: string }[] = [];

  const releaseStr = formatReleaseDate(publicationDate, publicationYear);
  if (releaseStr) details.push({ label: "Release date", value: releaseStr });
  if (pages) details.push({ label: "Pages", value: String(pages) });
  if (audioLengthMinutes) details.push({ label: "Audio length", value: formatAudioLength(audioLengthMinutes) });
  if (language) details.push({ label: "Language", value: language });
  if (publisher) details.push({ label: "Publisher", value: publisher });
  if (isbn13) details.push({ label: "ISBN", value: isbn13 });
  else if (isbn10) details.push({ label: "ISBN", value: isbn10 });
  if (asin) details.push({ label: "ASIN", value: asin });
  if (isFiction !== null) details.push({ label: "Type", value: isFiction ? "Fiction" : "Nonfiction" });
  if (seriesName) {
    const seriesStr = seriesPosition ? `${seriesName} #${seriesPosition}` : seriesName;
    details.push({ label: "Series", value: seriesStr });
  }

  const hasDescription = !!description;
  const hasDetails = details.length > 0;

  // If nothing at all, don't render
  if (!hasDescription && !hasDetails) return null;

  // If only description and no details, just show About without tabs
  const showTabs = hasDescription && hasDetails;

  const isLong = description ? description.length > 500 : false;
  const displayText = description
    ? isLong && !expanded
      ? description.slice(0, 500) + "..."
      : description
    : "";
  const html = displayText ? renderMarkdown(displayText) : "";

  return (
    <section className="mt-8">
      {showTabs ? (
        <>
          {/* H2 tabs with underline indicator */}
          <div className="flex gap-6 mb-4">
            <h2
              onClick={() => setActiveTab("about")}
              className={`section-heading relative cursor-pointer pb-1.5 text-xl transition-colors ${
                activeTab === "about"
                  ? "text-neon-blue"
                  : "text-muted/40 hover:text-muted/70"
              }`}
            >
              About
              {activeTab === "about" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-neon-blue" />
              )}
            </h2>
            <h2
              onClick={() => setActiveTab("details")}
              className={`section-heading relative cursor-pointer pb-1.5 text-xl transition-colors ${
                activeTab === "details"
                  ? "text-neon-blue"
                  : "text-muted/40 hover:text-muted/70"
              }`}
            >
              Details
              {activeTab === "details" && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full bg-neon-blue" />
              )}
            </h2>
          </div>

          {/* Tab content */}
          {activeTab === "about" && hasDescription && (
            <div>
              <div
                className="text-sm leading-relaxed text-muted"
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
            </div>
          )}

          {activeTab === "details" && (
            <DetailsTable details={details} />
          )}
        </>
      ) : hasDescription ? (
        <>
          <h2
            className="section-heading text-xl"
          >About</h2>
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
        </>
      ) : (
        <>
          <h2
            className="section-heading text-xl"
          >Details</h2>
          <DetailsTable details={details} />
        </>
      )}
    </section>
  );
}

function DetailsTable({ details }: { details: { label: string; value: string }[] }) {
  return (
    <dl className="space-y-2.5">
      {details.map(({ label, value }) => (
        <div key={label} className="flex items-baseline gap-3">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted w-24 flex-shrink-0">
            {label}
          </dt>
          <dd className="text-sm text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
