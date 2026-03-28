"use client";

import { useState } from "react";
import { PremiumBadge } from "@/components/premium-gate";

interface ExportSectionProps {
  isPremium: boolean;
}

export function ExportSection({ isPremium }: ExportSectionProps) {
  const [downloading, setDownloading] = useState<string | null>(null);

  function handleDownload(format: "csv" | "json") {
    if (format === "json" && !isPremium) return;
    setDownloading(format);
    // Use a hidden link to trigger download
    const link = document.createElement("a");
    link.href = `/api/export?format=${format}`;
    link.download = "";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Reset after a delay (download starts async)
    setTimeout(() => setDownloading(null), 3000);
  }

  return (
    <div className="rounded-xl border border-border bg-surface overflow-hidden">
      <div className="px-5 py-4 border-b border-border">
        <h2 className="section-heading text-lg">Export Your Data</h2>
        <p className="text-xs text-muted mt-0.5">
          Download your reading data to keep a backup or move to another platform.
        </p>
      </div>

      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* CSV Export — Free */}
        <button
          onClick={() => handleDownload("csv")}
          disabled={downloading === "csv"}
          className="flex items-start gap-3 rounded-lg border border-border bg-surface-alt p-4 text-left hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-accent/15 text-accent">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">
              {downloading === "csv" ? "Preparing..." : "Library Export"}
            </p>
            <p className="text-xs text-muted mt-0.5">
              CSV file compatible with Goodreads and StoryGraph. Includes your books, ratings, reviews, and reading dates.
            </p>
          </div>
        </button>

        {/* JSON Export — Premium */}
        <button
          onClick={() => handleDownload("json")}
          disabled={downloading === "json" || !isPremium}
          className={`flex items-start gap-3 rounded-lg border p-4 text-left transition-colors disabled:opacity-50 ${
            isPremium
              ? "border-border bg-surface-alt hover:bg-surface-hover"
              : "border-border/50 bg-surface-alt/50 cursor-not-allowed"
          }`}
        >
          <div className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-lg bg-neon-purple/15 text-neon-purple">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" x2="12" y1="15" y2="3" />
            </svg>
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-foreground">
                {downloading === "json" ? "Preparing..." : "Full Export"}
              </p>
              {!isPremium && <PremiumBadge />}
            </div>
            <p className="text-xs text-muted mt-0.5">
              {isPremium
                ? "Complete JSON with books, notes, reviews, preferences, social data, and more."
                : "Everything — notes, reviews, preferences, social data. Requires Based Reader."}
            </p>
          </div>
        </button>
      </div>
    </div>
  );
}
