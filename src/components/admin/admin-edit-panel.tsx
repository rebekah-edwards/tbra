"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  updateBookFields,
  uploadBookCover,
  addBookGenre,
  removeBookGenre,
  setBookCover,
} from "@/lib/actions/books";
import { BottomSheet } from "@/components/ui/bottom-sheet";

interface AdminEditPanelProps {
  bookId: string;
  bookTitle: string;
  openLibraryKey: string | null;
  authors: string[];
  currentValues: {
    coverImageUrl: string | null;
    title: string;
    publicationYear: number | null;
    publicationDate: string | null;
    pages: number | null;
    audioLengthMinutes: number | null;
    publisher: string | null;
    language: string | null;
    isbn13: string | null;
    isbn10: string | null;
    asin: string | null;
    isFiction: boolean | null;
    description: string | null;
    summary: string | null;
    genres: string[];
  };
}

type EditingField = {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "textarea";
  value: string | number | boolean | null;
} | null;

const FIELD_DEFS: {
  key: string;
  label: string;
  type: "text" | "number" | "boolean" | "textarea";
  mapKey: keyof AdminEditPanelProps["currentValues"];
}[] = [
  { key: "title", label: "Title", type: "text", mapKey: "title" },
  { key: "publicationYear", label: "Publication Year", type: "number", mapKey: "publicationYear" },
  { key: "publicationDate", label: "Publication Date", type: "text", mapKey: "publicationDate" },
  { key: "pages", label: "Pages", type: "number", mapKey: "pages" },
  { key: "audioLengthMinutes", label: "Audio Length (min)", type: "number", mapKey: "audioLengthMinutes" },
  { key: "publisher", label: "Publisher", type: "text", mapKey: "publisher" },
  { key: "language", label: "Language", type: "text", mapKey: "language" },
  { key: "isbn13", label: "ISBN-13", type: "text", mapKey: "isbn13" },
  { key: "isbn10", label: "ISBN-10", type: "text", mapKey: "isbn10" },
  { key: "asin", label: "ASIN", type: "text", mapKey: "asin" },
  { key: "isFiction", label: "Fiction", type: "boolean", mapKey: "isFiction" },
  { key: "description", label: "Description", type: "textarea", mapKey: "description" },
  { key: "summary", label: "Summary", type: "textarea", mapKey: "summary" },
];

function PencilIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
    </svg>
  );
}

export function AdminEditPanel({ bookId, bookTitle, openLibraryKey, authors, currentValues }: AdminEditPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState<EditingField>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [showCoverSheet, setShowCoverSheet] = useState(false);
  const [showGenreSheet, setShowGenreSheet] = useState(false);
  const [newGenre, setNewGenre] = useState("");
  const [editionCovers, setEditionCovers] = useState<{ coverId: number; title: string; format?: string; year?: string }[]>([]);
  const [externalCovers, setExternalCovers] = useState<{ url: string; source: string; label: string }[]>([]);
  const [loadingCovers, setLoadingCovers] = useState(false);
  const [loadingExternal, setLoadingExternal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function startEdit(fieldDef: typeof FIELD_DEFS[number]) {
    const val = currentValues[fieldDef.mapKey] as string | number | boolean | null;
    setEditing({
      key: fieldDef.key,
      label: fieldDef.label,
      type: fieldDef.type,
      value: val,
    });
    setEditValue(val === null || val === undefined ? "" : String(val));
  }

  async function saveField() {
    if (!editing) return;
    setSaving(true);

    let parsedValue: string | number | boolean | null;
    if (editing.type === "number") {
      parsedValue = editValue === "" ? null : Number(editValue);
      if (parsedValue !== null && isNaN(parsedValue as number)) {
        setSaving(false);
        return;
      }
    } else if (editing.type === "boolean") {
      parsedValue = editValue === "true";
    } else {
      parsedValue = editValue === "" ? null : editValue;
    }

    await updateBookFields(bookId, { [editing.key]: parsedValue });
    setSaving(false);
    setEditing(null);
    router.refresh();
  }

  async function openCoverEditor() {
    setShowCoverSheet(true);
    setEditionCovers([]);
    setExternalCovers([]);

    // Fetch OL editions and external covers (ISBNdb + Google Books) in parallel
    const olPromise = openLibraryKey ? (async () => {
      setLoadingCovers(true);
      try {
        const res = await fetch(`/api/openlibrary/editions?workKey=${encodeURIComponent(openLibraryKey)}&limit=100`);
        if (res.ok) {
          const data = await res.json();
          const covers: { coverId: number; title: string; format?: string; year?: string }[] = [];
          const seenIds = new Set<number>();
          for (const ed of data.entries) {
            if (ed.covers) {
              for (const cid of ed.covers) {
                if (cid > 0 && !seenIds.has(cid)) {
                  seenIds.add(cid);
                  covers.push({
                    coverId: cid,
                    title: ed.title,
                    format: ed.physical_format,
                    year: ed.publish_date,
                  });
                }
              }
            }
          }
          setEditionCovers(covers);
        }
      } catch { /* ignore */ }
      setLoadingCovers(false);
    })() : Promise.resolve();

    const extPromise = (async () => {
      setLoadingExternal(true);
      try {
        const params = new URLSearchParams();
        if (currentValues.isbn13) params.set("isbn13", currentValues.isbn13);
        if (currentValues.isbn10) params.set("isbn10", currentValues.isbn10);
        if (currentValues.title) params.set("title", currentValues.title);
        if (authors.length > 0) params.set("authors", authors.join(", "));
        const res = await fetch(`/api/admin/covers?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          setExternalCovers(data.covers ?? []);
        }
      } catch { /* ignore */ }
      setLoadingExternal(false);
    })();

    await Promise.all([olPromise, extPromise]);
  }

  async function handleCoverUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setSaving(true);
    const formData = new FormData();
    formData.append("cover", file);
    const result = await uploadBookCover(bookId, formData);
    setSaving(false);
    if (result.success) {
      setShowCoverSheet(false);
      router.refresh();
    }
    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function selectOLCover(coverId: number) {
    setSaving(true);
    try {
      const url = `https://covers.openlibrary.org/b/id/${coverId}-L.jpg`;
      const result = await setBookCover(bookId, url);
      if (!result.success) {
        alert(result.error || "Failed to set cover");
        return;
      }
      setShowCoverSheet(false);
      router.refresh();
    } catch (err) {
      console.error("Failed to set cover:", err);
      alert("Failed to set cover. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddGenre() {
    if (!newGenre.trim()) return;
    setSaving(true);
    await addBookGenre(bookId, newGenre.trim());
    setNewGenre("");
    setSaving(false);
    router.refresh();
  }

  async function handleRemoveGenre(name: string) {
    setSaving(true);
    await removeBookGenre(bookId, name);
    setSaving(false);
    router.refresh();
  }

  function displayValue(fieldDef: typeof FIELD_DEFS[number]): string {
    const val = currentValues[fieldDef.mapKey];
    if (val === null || val === undefined) return "—";
    if (fieldDef.type === "boolean") return val ? "Fiction" : "Nonfiction";
    if (fieldDef.key === "audioLengthMinutes" && typeof val === "number") {
      const h = Math.floor(val / 60);
      const m = val % 60;
      return h > 0 ? `${h}h ${m}m (${val} min)` : `${m}m`;
    }
    return String(val);
  }

  return (
    <>
      {/* Admin edit toolbar */}
      <section className="mt-8">
        <button
          onClick={() => setExpanded((p) => !p)}
          className="flex w-full items-center justify-between"
        >
          <h2
            className="section-heading text-xl"
          >
            Admin Edit
          </h2>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {expanded && (
          <div className="mt-4">
            {/* Cover */}
            <div className="mb-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-muted w-28">Cover</span>
                <button
                  onClick={openCoverEditor}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <PencilIcon /> Change
                </button>
              </div>
            </div>

            {/* Genres */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-medium uppercase tracking-wide text-muted w-28">Genres</span>
                <button
                  onClick={() => setShowGenreSheet(true)}
                  className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
                >
                  <PencilIcon /> Edit
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {currentValues.genres.map((g) => (
                  <span key={g} className="rounded-full bg-surface-alt px-2.5 py-0.5 text-xs text-foreground">
                    {g}
                  </span>
                ))}
                {currentValues.genres.length === 0 && (
                  <span className="text-xs text-muted">None</span>
                )}
              </div>
            </div>

            {/* All other fields */}
            <dl className="space-y-2">
              {FIELD_DEFS.map((fd) => (
                <div key={fd.key} className="flex items-baseline gap-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted w-28 flex-shrink-0">
                    {fd.label}
                  </dt>
                  <dd className="text-sm text-foreground flex-1 min-w-0 truncate">
                    {displayValue(fd)}
                  </dd>
                  <button
                    onClick={() => startEdit(fd)}
                    className="flex-shrink-0 text-muted hover:text-primary transition-colors p-0.5"
                    title={`Edit ${fd.label}`}
                  >
                    <PencilIcon />
                  </button>
                </div>
              ))}
            </dl>
          </div>
        )}
      </section>

      {/* Field edit bottom sheet */}
      {editing && (
        <BottomSheet
          open={!!editing}
          onClose={() => setEditing(null)}
          title={`Edit ${editing.label}`}
        >
          <div className="px-1 pb-4">
            {editing.type === "boolean" ? (
              <div className="flex gap-2">
                {["true", "false"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setEditValue(v)}
                    className={`flex-1 rounded-lg px-4 py-2.5 text-sm font-medium border-2 transition-all ${
                      editValue === v
                        ? "border-primary bg-primary/15 text-primary"
                        : "border-border bg-surface-alt/50 text-muted hover:border-primary/30"
                    }`}
                  >
                    {v === "true" ? "Fiction" : "Nonfiction"}
                  </button>
                ))}
              </div>
            ) : editing.type === "textarea" ? (
              <textarea
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                autoFocus
              />
            ) : (
              <input
                type={editing.type === "number" ? "number" : "text"}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
                autoFocus
                placeholder={editing.label}
              />
            )}

            <div className="mt-3 flex gap-2">
              <button
                onClick={saveField}
                disabled={saving}
                className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-background disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              {editing.type !== "boolean" && (
                <button
                  onClick={() => {
                    setEditValue("");
                    saveField();
                  }}
                  disabled={saving}
                  className="rounded-xl bg-surface-alt px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground disabled:opacity-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </BottomSheet>
      )}

      {/* Cover editor bottom sheet */}
      {showCoverSheet && (
        <BottomSheet
          open={showCoverSheet}
          onClose={() => setShowCoverSheet(false)}
          title={`Cover for "${bookTitle}"`}
        >
          <div className="px-1 pb-4">
            {/* Upload section */}
            <div className="mb-4">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-2">
                Upload Custom Cover
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={handleCoverUpload}
                className="w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary/15 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-primary hover:file:bg-primary/25 file:cursor-pointer"
              />
              <p className="mt-1 text-[10px] text-muted">JPG, PNG, or WebP. Max 2MB.</p>
            </div>

            {/* URL input */}
            <div className="mb-4">
              <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-2">
                Or Paste Cover URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="https://..."
                  id="cover-url-input"
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                />
                <button
                  onClick={async () => {
                    const input = document.getElementById("cover-url-input") as HTMLInputElement;
                    const url = input?.value?.trim();
                    if (!url) return;
                    setSaving(true);
                    const result = await setBookCover(bookId, url);
                    setSaving(false);
                    if (!result.success) {
                      alert(result.error || "Failed to set cover");
                      return;
                    }
                    setShowCoverSheet(false);
                    router.refresh();
                  }}
                  disabled={saving}
                  className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-background disabled:opacity-50"
                >
                  Set
                </button>
              </div>
            </div>

            {/* OL edition covers */}
            {loadingCovers && (
              <div className="flex items-center justify-center py-6">
                <div className="w-6 h-6 border-2 border-muted/30 border-t-foreground rounded-full animate-spin" />
              </div>
            )}
            {!loadingCovers && editionCovers.length > 0 && (
              <>
                <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-2">
                  Open Library Editions ({editionCovers.length})
                </label>
                <div className="grid grid-cols-4 gap-2 max-h-[300px] overflow-y-auto">
                  {editionCovers.map((ec) => (
                    <button
                      key={ec.coverId}
                      onClick={() => selectOLCover(ec.coverId)}
                      disabled={saving}
                      className="flex flex-col items-center gap-0.5 rounded-lg p-1 hover:bg-surface-alt transition-colors disabled:opacity-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://covers.openlibrary.org/b/id/${ec.coverId}-M.jpg`}
                        alt={ec.title}
                        className="w-full aspect-[2/3] rounded object-cover border border-border"
                        loading="lazy"
                      />
                      <span className="text-[9px] text-muted leading-tight text-center line-clamp-1">
                        {[ec.format, ec.year].filter(Boolean).join(" · ") || ec.title}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ISBNdb + Google Books covers */}
            {loadingExternal && (
              <div className="flex items-center justify-center py-4">
                <div className="w-5 h-5 border-2 border-muted/30 border-t-foreground rounded-full animate-spin" />
                <span className="ml-2 text-xs text-muted">Searching ISBNdb & Google Books...</span>
              </div>
            )}
            {!loadingExternal && externalCovers.length > 0 && (
              <>
                <label className="block text-xs font-medium uppercase tracking-wide text-muted mb-2 mt-4">
                  ISBNdb & Google Books ({externalCovers.length})
                </label>
                <div className="grid grid-cols-4 gap-2 max-h-[300px] overflow-y-auto">
                  {externalCovers.map((ec, i) => (
                    <button
                      key={`${ec.source}-${i}`}
                      onClick={async () => {
                        setSaving(true);
                        try {
                          const result = await setBookCover(bookId, ec.url);
                          if (!result.success) {
                            alert(result.error || "Failed to set cover");
                            return;
                          }
                          setShowCoverSheet(false);
                          router.refresh();
                        } catch (err) {
                          console.error("Failed to set cover:", err);
                          alert("Failed to set cover. Please try again.");
                        } finally {
                          setSaving(false);
                        }
                      }}
                      disabled={saving}
                      className="flex flex-col items-center gap-0.5 rounded-lg p-1 hover:bg-surface-alt transition-colors disabled:opacity-50"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ec.url}
                        alt="Cover option"
                        className="w-full aspect-[2/3] rounded object-cover border border-border"
                        loading="lazy"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                      <span className="text-[9px] text-muted leading-tight text-center line-clamp-2">
                        {ec.label}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* Remove cover */}
            <button
              onClick={async () => {
                setSaving(true);
                try {
                  const result = await setBookCover(bookId, null);
                  if (!result.success) {
                    alert(result.error || "Failed to remove cover");
                    return;
                  }
                  setShowCoverSheet(false);
                  router.refresh();
                } catch (err) {
                  console.error("Failed to remove cover:", err);
                  alert("Failed to remove cover. Please try again.");
                } finally {
                  setSaving(false);
                }
              }}
              disabled={saving}
              className="mt-4 w-full rounded-xl bg-surface-alt text-muted py-2.5 text-sm font-medium hover:text-foreground transition-colors disabled:opacity-50"
            >
              Remove Cover
            </button>
          </div>
        </BottomSheet>
      )}

      {/* Genre editor bottom sheet */}
      {showGenreSheet && (
        <BottomSheet
          open={showGenreSheet}
          onClose={() => setShowGenreSheet(false)}
          title="Edit Genres"
        >
          <div className="px-1 pb-4">
            {/* Current genres with remove buttons */}
            <div className="flex flex-wrap gap-2 mb-4">
              {currentValues.genres.map((g) => (
                <span
                  key={g}
                  className="inline-flex items-center gap-1 rounded-full bg-surface-alt pl-2.5 pr-1.5 py-1 text-xs text-foreground"
                >
                  {g}
                  <button
                    onClick={() => handleRemoveGenre(g)}
                    disabled={saving}
                    className="w-4 h-4 rounded-full flex items-center justify-center text-muted hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-50"
                  >
                    ×
                  </button>
                </span>
              ))}
              {currentValues.genres.length === 0 && (
                <span className="text-xs text-muted">No genres yet</span>
              )}
            </div>

            {/* Add genre */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newGenre}
                onChange={(e) => setNewGenre(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleAddGenre()}
                placeholder="Add genre..."
                className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
              />
              <button
                onClick={handleAddGenre}
                disabled={saving || !newGenre.trim()}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
              >
                Add
              </button>
            </div>
            <p className="mt-1.5 text-[10px] text-muted">
              Genre names are auto-title-cased. Press Enter to add quickly.
            </p>
          </div>
        </BottomSheet>
      )}
    </>
  );
}
