"use client";

import { useState, useRef } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";

const ARC_SOURCES = [
  { value: "netgalley", label: "NetGalley" },
  { value: "publisher_arc", label: "Publisher ARC" },
  { value: "author_copy", label: "Author Copy" },
  { value: "booksirens", label: "BookSirens" },
  { value: "edelweiss", label: "Edelweiss+" },
  { value: "other", label: "Other" },
] as const;

export interface ArcSourceData {
  arcSource: string;
  arcSourceDetail: string | null;
  arcProofUrl: string;
}

interface ArcSourceFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: ArcSourceData) => void;
  title?: string;
  description?: string;
}

export function ArcSourceForm({
  open,
  onClose,
  onSubmit,
  title = "Pre-Publication Rating",
  description = "This book hasn't been published yet, but readers with advance copies may rate and review it. Please provide your book source to help protect rating integrity. Your submission will be reviewed by a member of our team.",
}: ArcSourceFormProps) {
  const [source, setSource] = useState("");
  const [sourceDetail, setSourceDetail] = useState("");
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isOther = source === "other";
  const canSubmit = source && proofUrl && (!isOther || sourceDetail.trim());

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("proof", file);

      const res = await fetch("/api/arc-proof", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Upload failed");
      }

      const data = await res.json();
      setProofUrl(data.proofUrl);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit() {
    if (!canSubmit || !proofUrl) return;
    onSubmit({
      arcSource: source,
      arcSourceDetail: isOther ? sourceDetail.trim() : null,
      arcProofUrl: proofUrl,
    });
    // Reset form
    setSource("");
    setSourceDetail("");
    setProofUrl(null);
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <div className="px-4 pb-4 space-y-4">
        <p className="text-sm text-muted leading-relaxed">{description}</p>

        {/* Source dropdown */}
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1.5">
            Book Source
          </label>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          >
            <option value="">Select how you received this book...</option>
            {ARC_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Other detail */}
        {isOther && (
          <div>
            <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1.5">
              Details
            </label>
            <input
              type="text"
              value={sourceDetail}
              onChange={(e) => setSourceDetail(e.target.value)}
              placeholder="How did you receive this book?"
              className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted/50 focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>
        )}

        {/* Proof upload */}
        <div>
          <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-1.5">
            Upload Proof
          </label>
          <p className="text-[11px] text-muted/60 mb-2">
            Screenshot or photo showing you received an advance copy (e.g., NetGalley approval, publisher email, physical ARC)
          </p>
          {proofUrl ? (
            <div className="flex items-center gap-3 rounded-lg border border-accent/30 bg-accent/5 px-3 py-2">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-accent shrink-0">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span className="text-sm text-accent flex-1">Proof uploaded</span>
              <button
                type="button"
                onClick={() => { setProofUrl(null); if (fileRef.current) fileRef.current.value = ""; }}
                className="text-xs text-muted hover:text-foreground"
              >
                Replace
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="w-full rounded-lg border-2 border-dashed border-border py-3 text-sm text-muted hover:border-accent/30 hover:text-foreground transition-colors disabled:opacity-50"
            >
              {uploading ? "Uploading..." : "Choose file..."}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileChange}
            className="hidden"
          />
          {uploadError && (
            <p className="mt-1 text-xs text-red-400">{uploadError}</p>
          )}
        </div>

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-black transition-all hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Submit
        </button>
      </div>
    </BottomSheet>
  );
}
